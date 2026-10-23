/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PluginNative } from "@utils/types";

import { t } from "./i18n";
import { archiveSource, fileNameFor, MediaKind, SavedMedia } from "./model";
import { settings } from "./settings";

const FOLDERS: Record<MediaKind, string> = {
    gif: "GIF",
    image: "Images",
    video: "Videos",
    audio: "Audio",
    file: "Fichiers"
};

const Native = (typeof VencordNative !== "undefined" ? VencordNative.pluginHelpers?.MediaVault : undefined) as PluginNative<typeof import("./native")> | undefined;

/** Real files on disk only exist in the desktop app. */
export const canUseDisk = !!Native;

export async function diskFolder(): Promise<string | null> {
    return Native ? Native.getFolder() : null;
}

export async function openDiskFolder(): Promise<string | null> {
    return Native ? Native.openFolder() : t("toast.desktopOnly");
}

export async function writeToDisk(item: Pick<SavedMedia, "url" | "previewUrl" | "name" | "kind">, blob: Blob): Promise<boolean> {
    if (!Native) return false;
    const fileName = fileNameFor(item.name, archiveSource(item), blob.type);
    await Native.writeCopy([FOLDERS[item.kind]], fileName, new Uint8Array(await blob.arrayBuffer()));
    return true;
}

export const mirrorEnabled = () => canUseDisk && settings.store.mirrorToDisk;

/** Fetches a media through the desktop app's main process. Returns null on the web version or on failure. */
export async function nativeFetch(url: string): Promise<Blob | null> {
    if (!Native) return null;
    try {
        const result = await Native.fetchMedia(url);
        return result ? new Blob([new Uint8Array(result.data)], { type: result.type }) : null;
    } catch {
        return null;
    }
}
