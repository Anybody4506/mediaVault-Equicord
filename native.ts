/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, IpcMainInvokeEvent, shell } from "electron";
import { existsSync, mkdirSync, statSync, writeFileSync } from "fs";
import { join, parse } from "path";

const root = () => join(app.getPath("pictures"), "MediaVault");
const clean = (part: string) => part.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "media";

export function getFolder(_: IpcMainInvokeEvent): string {
    return root();
}

export async function openFolder(_: IpcMainInvokeEvent): Promise<string | null> {
    mkdirSync(root(), { recursive: true });
    return (await shell.openPath(root())) || null;
}

/** Writes a copy as a normal file. A file of the same name and size is considered already saved. */
export function writeCopy(_: IpcMainInvokeEvent, folders: string[], fileName: string, data: Uint8Array): string {
    const directory = join(root(), ...folders.map(clean));
    mkdirSync(directory, { recursive: true });
    const { name, ext } = parse(clean(fileName));
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

const MAX_FETCH_SIZE = 50 * 1024 * 1024;

/**
 * Downloads a media from the main process, where the page's content security policy
 * and CORS do not apply. Tenor page links are resolved to the media file they show.
 */
export async function fetchMedia(_: IpcMainInvokeEvent, url: string): Promise<{ data: Uint8Array; type: string; } | null> {
    if (!/^https:\/\//i.test(url)) return null;
    const get = async (target: string) => {
        const response = await fetch(target, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
        if (!response.ok) return null;
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > MAX_FETCH_SIZE) return null;
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.byteLength > MAX_FETCH_SIZE) return null;
        return { data: buffer, type: (response.headers.get("content-type") ?? "").split(";")[0].trim() };
    };
    const first = await get(url);
    if (!first) return null;
    if (first.type === "text/html" && /tenor\.com\//i.test(url)) {
        const media = /https:\/\/media\d*\.tenor\.com\/[^"'\s]+?\.(?:mp4|webm|gif)/i.exec(new TextDecoder().decode(first.data))?.[0];
        return media ? get(media) : null;
    }
    return /^(image|video|audio)\//.test(first.type) ? first : null;
}
