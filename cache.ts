/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { clear, createStore, del, get, keys as storeKeys, set, values } from "@api/DataStore";
import { useCallback, useEffect, useState } from "@webpack/common";

import { mirrorEnabled, nativeFetch, writeToDisk } from "./mirror";
import { archiveSource, LibraryData, MediaKind, originalFileUrl, sameFormat, SavedMedia, urlKey } from "./model";
import { settings } from "./settings";
import { refreshUrl, useFreshUrl } from "./urls";

const MAX_BLOB_SIZE = 50 * 1024 * 1024;
const store = createStore("MediaVaultCache", "previews");
const objectUrls = new Map<string, string>();
const attempted = new Set<string>();
const unavailable = new Set<string>();

/** Media whose file could not be found this session (deleted attachment, dead link) and that have no local copy. */
export const isUnavailable = (url: string) => unavailable.has(previewKey(url));

const CACHE_CHANGED_EVENT = "vc-mediavault-cache";
const LEGACY_PREFIX = "file:";

// One file, one entry: an image's preview and its archive are the same file, so they share a key.
const previewKey = (url: string) => urlKey(url);
const archiveKey = (item: Pick<SavedMedia, "url" | "previewUrl">) => urlKey(archiveSource(item));

const changed = () => window.dispatchEvent(new CustomEvent(CACHE_CHANGED_EVENT));

export function onCacheChanged(listener: () => void) {
    window.addEventListener(CACHE_CHANGED_EVENT, listener);
    return () => window.removeEventListener(CACHE_CHANGED_EVENT, listener);
}

/** Keys of every media key (as {@link urlKey}) currently stored locally. */
export async function cacheKeys(): Promise<Set<string>> {
    return new Set((await storeKeys<string>(store)).filter(key => !key.startsWith(LEGACY_PREFIX)));
}

export const hasLocalCopy = (keys: Set<string>, item: Pick<SavedMedia, "url" | "previewUrl">) => keys.has(archiveKey(item));
export const hasLocalPreview = (keys: Set<string>, url: string | undefined) => !!url && keys.has(previewKey(url));

const isMedia = (blob: Blob | null): blob is Blob => !!blob && blob.size > 0 && blob.size <= MAX_BLOB_SIZE && /^(image|video|audio)\//.test(blob.type);

/** Downloads a media file. Falls back to the desktop app when the browser is blocked (CORS, content policy, HTML pages). */
export async function download(url: string): Promise<Blob | null> {
    const target = originalFileUrl(await refreshUrl(url));
    try {
        const response = await fetch(target);
        if (response.ok) {
            const blob = await response.blob();
            if (isMedia(blob)) return blob;
        }
    } catch {
        // Blocked by CORS or the content policy: try the desktop app below.
    }
    const viaApp = await nativeFetch(target);
    return isMedia(viaApp) ? viaApp : null;
}

export async function cacheMedia(url: string): Promise<boolean> {
    const key = previewKey(url);
    if (await get(key, store)) return false;
    const blob = await download(url);
    if (!blob) return false;
    await set(key, blob, store);
    changed();
    return true;
}

export function shouldArchive(kind: MediaKind): boolean {
    const mode = settings.store.archiveMode;
    if (mode === "none") return false;
    if (mode === "visual") return kind === "gif" || kind === "image" || kind === "video";
    return kind === "gif";
}

/** Keeps a full copy of the media itself so it can still be sent once the link is gone. */
export async function archiveMedia(item: Pick<SavedMedia, "url" | "previewUrl" | "kind" | "name">): Promise<boolean> {
    if (!shouldArchive(item.kind)) return false;
    const key = archiveKey(item);
    const existing = await get<Blob>(key, store);
    const source = archiveSource(item);
    // Copies made by older versions may have been converted (a png saved as webp): fetch the original again.
    if (existing && sameFormat(existing.type, source)) {
        if (mirrorEnabled()) void writeToDisk(item, existing).catch(() => undefined);
        return false;
    }
    const blob = await download(source);
    if (!blob) return false;
    await set(key, blob, store);
    if (mirrorEnabled()) void writeToDisk(item, blob).catch(() => undefined);
    changed();
    return true;
}

export async function getArchive(item: Pick<SavedMedia, "url" | "previewUrl">): Promise<Blob | undefined> {
    const key = archiveKey(item);
    return await get<Blob>(key, store) ?? await get<Blob>(`${LEGACY_PREFIX}${key}`, store);
}

let migrated = false;

/** Folds the duplicate `file:` entries of earlier versions into the shared keys. Returns how many were merged. */
export async function migrateCache(): Promise<number> {
    if (migrated) return 0;
    migrated = true;
    let merged = 0;
    for (const key of await storeKeys<string>(store)) {
        if (!key.startsWith(LEGACY_PREFIX)) continue;
        const target = key.slice(LEGACY_PREFIX.length);
        if (!await get(target, store)) {
            const blob = await get<Blob>(key, store);
            if (blob) await set(target, blob, store);
        }
        await del(key, store);
        merged++;
    }
    if (merged) changed();
    return merged;
}

/** Removes local copies that no media of this library refers to any more. */
export async function pruneCache(library: LibraryData): Promise<number> {
    const wanted = new Set<string>();
    for (const item of library.items) {
        wanted.add(archiveKey(item));
        wanted.add(previewKey(item.url));
        if (item.previewUrl) wanted.add(previewKey(item.previewUrl));
    }
    for (const category of library.categories) if (category.thumbnail) wanted.add(previewKey(category.thumbnail));
    let removed = 0;
    for (const key of await storeKeys<string>(store)) {
        if (wanted.has(key)) continue;
        const objectUrl = objectUrls.get(key);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrls.delete(key);
        await del(key, store);
        removed++;
    }
    if (removed) changed();
    return removed;
}

let backgroundRunning = false;
const backgroundQueue: Pick<SavedMedia, "url" | "previewUrl" | "kind" | "name">[] = [];

/** Archives in the background, one file at a time, at most once per session per media. */
export function archiveInBackground(items: Pick<SavedMedia, "url" | "previewUrl" | "kind" | "name">[]) {
    for (const item of items) {
        const key = archiveKey(item);
        if (!shouldArchive(item.kind) || attempted.has(key)) continue;
        attempted.add(key);
        backgroundQueue.push(item);
    }
    if (backgroundRunning) return;
    backgroundRunning = true;
    void (async () => {
        while (backgroundQueue.length) {
            const item = backgroundQueue.shift();
            if (item) await archiveMedia(item).catch(() => undefined);
        }
        backgroundRunning = false;
    })();
}

export async function uncacheMedia(item: Pick<SavedMedia, "url" | "previewUrl">) {
    const wanted = new Set([archiveKey(item), ...[item.url, item.previewUrl].filter((url): url is string => !!url).map(previewKey)]);
    for (const key of wanted) {
        const objectUrl = objectUrls.get(key);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrls.delete(key);
        await del(key, store);
    }
    changed();
}

async function objectUrlFor(key: string): Promise<string | null> {
    const known = objectUrls.get(key);
    if (known) return known;
    const blob = await get<Blob>(key, store);
    if (!blob) return null;
    const objectUrl = URL.createObjectURL(blob);
    objectUrls.set(key, objectUrl);
    return objectUrl;
}

export async function cacheStats(): Promise<{ count: number; bytes: number; }> {
    const blobs = await values<Blob>(store);
    return { count: blobs.length, bytes: blobs.reduce((total, blob) => total + blob.size, 0) };
}

export async function clearCache() {
    disposeCache();
    attempted.clear();
    await clear(store);
    changed();
}

export function disposeCache() {
    for (const objectUrl of objectUrls.values()) URL.revokeObjectURL(objectUrl);
    objectUrls.clear();
}

/**
 * Display link for a stored media: refreshed when expired, then the cached preview,
 * then the archived file when the network copy is gone.
 */
export function useMediaSrc(url: string | undefined, archived?: Pick<SavedMedia, "url" | "previewUrl">) {
    const fresh = useFreshUrl(url);
    const [local, setLocal] = useState<{ src: string; type: string; }>();
    const [failed, setFailed] = useState(false);
    const archivedKey = archived ? archiveKey(archived) : undefined;

    useEffect(() => {
        setLocal(undefined);
        setFailed(false);
    }, [url]);

    const onError = useCallback(() => {
        if (!url || local) {
            setFailed(true);
            return;
        }
        void (async () => {
            // 1. A copy already stored locally.
            const candidates = [previewKey(url), archivedKey].filter((key): key is string => !!key);
            for (const key of candidates) {
                const blob = await get<Blob>(key, store);
                if (!blob) continue;
                const objectUrl = await objectUrlFor(key);
                if (objectUrl) return setLocal({ src: objectUrl, type: blob.type });
            }
            // 2. Download it again (through the desktop app if the browser is blocked) and keep it.
            const blob = await download(url).catch(() => null);
            if (blob) {
                const key = previewKey(url);
                if (settings.store.cachePreviews) {
                    await set(key, blob, store).catch(() => undefined);
                    changed();
                }
                const objectUrl = URL.createObjectURL(blob);
                objectUrls.set(key, objectUrl);
                return setLocal({ src: objectUrl, type: blob.type });
            }
            if (!unavailable.has(previewKey(url))) {
                unavailable.add(previewKey(url));
                console.warn("[MediaVault] Preview could not be loaded (file deleted or link dead):", url);
                changed();
            }
            setFailed(true);
        })();
    }, [url, local, archivedKey]);

    return { src: local?.src ?? fresh, type: local?.type, onError, failed };
}
