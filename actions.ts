/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserStore } from "@webpack/common";

import { archiveMedia, cacheMedia, getArchive, uncacheMedia } from "./cache";
import { setNativeGif } from "./discord";
import { t } from "./i18n";
import { archiveSource, canonicalUrl, fileNameFor, hasMedia, inferKind, LibraryData, MediaKind, mediaNameFromUrl, originalFileUrl, removeMedia, SavedMedia, saveMedia } from "./model";
import { settings } from "./settings";
import { loadLibrary, updateLibrary } from "./store";

export interface MediaInput {
    url: string;
    previewUrl?: string;
    name?: string;
    kind?: MediaKind;
    contentType?: string;
    width?: number;
    height?: number;
    messageUrl?: string;
    sourceUrl?: string;
}

export type PreparedMedia = Omit<SavedMedia, "categoryId" | "savedAt">;

export const currentAccountId = () => UserStore.getCurrentUser()?.id;

export function makeMedia(input: MediaInput): PreparedMedia | null {
    if (!input.url || !/^https?:\/\//i.test(input.url)) return null;
    return {
        url: input.url,
        previewUrl: input.previewUrl && input.previewUrl !== input.url ? input.previewUrl : undefined,
        name: input.name?.trim() || mediaNameFromUrl(input.url),
        kind: input.kind ?? inferKind(input.url, input.contentType, input.name),
        width: input.width || undefined,
        height: input.height || undefined,
        messageUrl: input.messageUrl,
        sourceUrl: input.sourceUrl
    };
}

export function starEnabledFor(kind: MediaKind): boolean {
    const store = settings.store;
    switch (kind) {
        case "image": return store.showImageStar;
        case "video": return store.showVideoStar;
        case "audio": return store.showAudioStar;
        case "file": return store.showFileStar;
        default: return false;
    }
}

function cacheable(media: Pick<SavedMedia, "kind" | "url" | "previewUrl">) {
    if (!settings.store.cachePreviews) return [];
    if (media.kind === "video") return media.previewUrl ? [media.previewUrl] : [];
    return media.kind === "gif" || media.kind === "image" ? [media.previewUrl ?? media.url] : [];
}

export async function addMedia(accountId: string, input: MediaInput): Promise<void> {
    const media = makeMedia(input);
    if (!media) return;
    const nativeFavorite = media.kind === "gif" && await setNativeGif(media, true);
    await updateLibrary(accountId, current => saveMedia(current, { ...media, nativeFavorite: nativeFavorite || undefined }));
    // One after the other: a preview and its archive are often the same file.
    void (async () => {
        for (const url of cacheable(media)) await cacheMedia(url).catch(() => undefined);
        await archiveMedia(media).catch(() => undefined);
    })();
}

const recentlyRemoved = new Map<string, number>();
const REMOVAL_GRACE = 2 * 60 * 1000;

/** Drops GIFs removed a moment ago, so a sync running before Discord has applied the removal cannot bring them back. */
export function withoutRecentlyRemoved<T extends { url: string; }>(list: T[]): T[] {
    const now = Date.now();
    for (const [key, time] of recentlyRemoved) if (now - time > REMOVAL_GRACE) recentlyRemoved.delete(key);
    return recentlyRemoved.size ? list.filter(entry => !recentlyRemoved.has(canonicalUrl(entry.url))) : list;
}

export async function removeSaved(accountId: string, item: Pick<SavedMedia, "kind" | "url" | "previewUrl" | "nativeFavorite">): Promise<void> {
    if (item.kind === "gif") {
        recentlyRemoved.set(canonicalUrl(item.url), Date.now());
        await setNativeGif(item, false);
    }
    await updateLibrary(accountId, current => removeMedia(current, item.url));
    void uncacheMedia(item).catch(() => undefined);
}

/** Returns true when the media is saved after the call. */
export async function toggleSavedMedia(accountId: string, input: MediaInput): Promise<boolean> {
    const prepared = makeMedia(input);
    if (!prepared) return false;
    const library: LibraryData = await loadLibrary(accountId);
    const existing = library.items.find(item => canonicalUrl(item.url) === canonicalUrl(prepared.url));
    if (existing) {
        await removeSaved(accountId, existing);
        return false;
    }
    await addMedia(accountId, input);
    return true;
}

export async function isSaved(accountId: string, url: string): Promise<boolean> {
    return hasMedia(await loadLibrary(accountId), url);
}

export function getMessageUrl(message: { id?: string; channel_id?: string; guild_id?: string | null; guildId?: string | null; } | undefined): string | undefined {
    if (!message?.id || !message.channel_id) return undefined;
    return `https://discord.com/channels/${message.guild_id ?? message.guildId ?? "@me"}/${message.channel_id}/${message.id}`;
}

interface MessageLike {
    id?: string;
    channel_id?: string;
    guild_id?: string | null;
    content?: string;
    attachments?: { url?: string; proxy_url?: string; filename?: string; content_type?: string; width?: number; height?: number; }[];
    embeds?: {
        url?: string;
        title?: string;
        image?: { url?: string; proxyURL?: string; width?: number; height?: number; };
        thumbnail?: { url?: string; proxyURL?: string; width?: number; height?: number; };
        video?: { url?: string; proxyURL?: string; width?: number; height?: number; };
    }[];
}

export function getMediaFromMessage(message: MessageLike | undefined): PreparedMedia[] {
    const found = new Map<string, PreparedMedia>();
    const messageUrl = getMessageUrl(message);
    const add = (input: MediaInput) => {
        const media = makeMedia({ ...input, messageUrl });
        if (media) found.set(canonicalUrl(media.url), media);
    };

    for (const attachment of message?.attachments ?? []) {
        add({ url: attachment.url ?? "", previewUrl: attachment.proxy_url, name: attachment.filename, contentType: attachment.content_type, width: attachment.width, height: attachment.height });
    }
    for (const embed of message?.embeds ?? []) {
        const { image, thumbnail, video } = embed;
        if (image?.url) add({ url: image.url, previewUrl: image.proxyURL, name: embed.title ?? t("name.image"), kind: inferKind(image.url, "image/*"), width: image.width, height: image.height, sourceUrl: embed.url });
        else if (thumbnail?.url && !video?.url) add({ url: thumbnail.url, previewUrl: thumbnail.proxyURL, name: embed.title ?? t("name.thumbnail"), kind: inferKind(thumbnail.url, "image/*"), width: thumbnail.width, height: thumbnail.height, sourceUrl: embed.url });
        if (video?.url) add({ url: video.url, previewUrl: video.proxyURL ?? thumbnail?.proxyURL, name: embed.title ?? t("name.video"), kind: "video", width: video.width, height: video.height, sourceUrl: embed.url });
    }
    for (const match of String(message?.content ?? "").matchAll(/https?:\/\/[^\s<>]+/gi)) {
        const url = match[0].replace(/[),.!?]+$/, "");
        const kind = inferKind(url);
        if (kind !== "file") add({ url, kind });
    }
    return [...found.values()];
}

function saveBlob(blob: Blob, fileName: string) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
}

export async function downloadMedia(item: Pick<SavedMedia, "url" | "previewUrl" | "name">) {
    const { refreshUrl } = await import("./urls");
    // Tenor page links are HTML documents: the preview is the real file.
    const source = archiveSource(item);
    const url = originalFileUrl(await refreshUrl(source));
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const blob = await response.blob();
        saveBlob(blob, fileNameFor(item.name, source, blob.type));
    } catch (error) {
        console.warn("[MediaVault] Direct download failed, opening the link.", error);
        window.open(url, "_blank", "noopener,noreferrer");
    }
}

export function exportLibrary(library: LibraryData) {
    const blob = new Blob([JSON.stringify({ format: "MediaVault", version: 4, exportedAt: new Date().toISOString(), library }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `MediaVault-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Saves the locally stored file to disk with its real name and format. */
export async function saveLocalCopy(item: Pick<SavedMedia, "url" | "previewUrl" | "name">): Promise<boolean> {
    const blob = await getArchive(item);
    if (!blob) return false;
    saveBlob(blob, fileNameFor(item.name, archiveSource(item), blob.type));
    return true;
}
