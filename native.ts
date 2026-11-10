/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { lookup } from "dns/promises";
import { app, IpcMainInvokeEvent, shell } from "electron";
import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { isIP } from "net";
import { join, parse } from "path";

import { UNSAFE_NAME_CHARACTERS, withMediaExtension } from "./model";

const MAX_FETCH_SIZE = 50 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const root = () => join(app.getPath("pictures"), "MediaVault");
const clean = (part: string) => part.replace(UNSAFE_NAME_CHARACTERS, "_").replace(/^\.+/, "").trim().slice(0, 120).replace(/[.\s]+$/, "") || "media";

export function getFolder(_: IpcMainInvokeEvent): string {
    return root();
}

export async function openFolder(_: IpcMainInvokeEvent): Promise<string | null> {
    mkdirSync(root(), { recursive: true });
    return (await shell.openPath(root())) || null;
}

/** Writes a copy as a normal file. A file of the same name and size is considered already saved. */
export function writeCopy(_: IpcMainInvokeEvent, folders: string[], fileName: string, data: Uint8Array): string {
    if (!(data instanceof Uint8Array) || data.byteLength > MAX_FETCH_SIZE) throw new Error("This file is too large to be saved.");
    const directory = join(root(), ...folders.map(clean));
    mkdirSync(directory, { recursive: true });
    // Checked here too: any code running in Discord can call this helper, not only MediaVault's panel.
    const { name, ext } = parse(withMediaExtension(clean(fileName)));
    for (let index = 1; index < 500; index++) {
        const target = join(directory, index === 1 ? `${name}${ext}` : `${name} (${index})${ext}`);
        if (!existsSync(target)) {
            writeFileSync(target, data);
            return target;
        }
        if (statSync(target).size === data.byteLength) return target;
    }
    throw new Error("Too many files already use this name.");
}

/** True for loopback, private, link-local and other addresses that are not on the public internet. */
function isPrivateAddress(address: string): boolean {
    const mapped = address.toLowerCase().replace(/^::ffff:(?=\d+\.)/, "");
    if (isIP(mapped) === 4) {
        const [a, b] = mapped.split(".").map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }
    // IPv6: unspecified, loopback, IPv4-mapped in hex form, unique local, link-local and multicast.
    return mapped === "::" || mapped === "::1" || mapped.startsWith("::ffff:") || /^f[cd]/.test(mapped) || /^fe[89ab]/.test(mapped) || mapped.startsWith("ff");
}

/** Only public https links: a saved link or a redirect must not reach this computer or the local network. */
async function isPublicHttps(target: string): Promise<boolean> {
    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return false;
    }
    if (url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host)) return !isPrivateAddress(host);
    if (host === "localhost" || host.endsWith(".localhost")) return false;
    try {
        const addresses = await lookup(host, { all: true });
        return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address));
    } catch {
        return false;
    }
}

/** Reads a response body, giving up as soon as it goes over the size limit instead of loading it all first. */
async function readLimited(response: Response): Promise<Uint8Array | null> {
    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_FETCH_SIZE) {
            await reader.cancel().catch(() => undefined);
            return null;
        }
        chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return data;
}

/**
 * Downloads a media from the main process, where the page's content security policy
 * and CORS do not apply. Tenor page links are resolved to the media file they show.
 */
export async function fetchMedia(_: IpcMainInvokeEvent, url: string): Promise<{ data: Uint8Array; type: string; } | null> {
    const get = async (start: string) => {
        const signal = AbortSignal.timeout(20_000);
        let target = start;
        // Redirects are followed by hand so every step is checked, not only the first link.
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
            if (!await isPublicHttps(target)) return null;
            const response = await fetch(target, { redirect: "manual", signal });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get("location");
                await response.body?.cancel().catch(() => undefined);
                if (!location) return null;
                try {
                    target = new URL(location, target).toString();
                } catch {
                    return null;
                }
                continue;
            }
            const length = Number(response.headers.get("content-length") ?? 0);
            if (!response.ok || length > MAX_FETCH_SIZE) {
                await response.body?.cancel().catch(() => undefined);
                return null;
            }
            const data = await readLimited(response);
            return data && { data, type: (response.headers.get("content-type") ?? "").split(";")[0].trim() };
        }
        return null;
    };
    const first = await get(url);
    if (!first) return null;
    if (first.type === "text/html" && /tenor\.com\//i.test(url)) {
        const media = /https:\/\/media\d*\.tenor\.com\/[^"'\s]+?\.(?:mp4|webm|gif)/i.exec(new TextDecoder().decode(first.data))?.[0];
        return media ? get(media) : null;
    }
    return /^(image|video|audio)\//.test(first.type) ? first : null;
}
