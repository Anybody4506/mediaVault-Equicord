/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MessageAttachment } from "@vencord/discord-types";
import { findAll, findByCodeLazy, findByPropsLazy, findCssClassesLazy, proxyLazyWebpack } from "@webpack";
import { ChannelStore, ComponentDispatch, DraftType, ExpressionPickerStore, React, SelectedChannelStore, showToast, UploadHandler, useEffect, useMemo, UserSettingsActionCreators, UserSettingsProtoStore, useStateFromStores } from "@webpack/common";

import { getArchive } from "./cache";
import { t } from "./i18n";
import { archiveSource, canonicalUrl, fileNameFor, NativeGif, originalFileUrl, SavedMedia } from "./model";
import { settings } from "./settings";
import { needsRefresh, refreshUrl } from "./urls";

export interface AttachmentItem {
    contentType: string;
    type: "IMAGE" | "VIDEO" | "CLIP" | "AUDIO" | "VISUAL_PLACEHOLDER" | "PLAINTEXT_PREVIEW" | "OTHER" | "INVALID";
    width?: number;
    height?: number;
    downloadUrl: string;
    spoiler: boolean;
    srcIsAnimated: boolean;
    uniqueId: string;
    originalItem: MessageAttachment;
}

export type AttachmentTransformer = (attachment: MessageAttachment, inlineAttachmentMedia?: boolean) => AttachmentItem;

interface ImageUtilsType {
    isAnimated(image: { src?: string; original?: string; animated: boolean; srcIsAnimated?: boolean; }): boolean;
}

export const transformAttachment: AttachmentTransformer = findByCodeLazy("return{uniqueId", ".IS_ANIMATED");
export const ImageUtils: ImageUtilsType = findByPropsLazy("isAnimated", "getFormatQuality");
const UserSettingsDelay = findByPropsLazy("INFREQUENT_USER_ACTION");

export const EmbedContext = proxyLazyWebpack(() => React.createContext<any>(null));
export const EmbedMosaicContext = proxyLazyWebpack(() => React.createContext<number | null>(null));
export const AttachmentContext = proxyLazyWebpack(() => React.createContext<AttachmentItem | null>(null));

interface FavoriteGifsProto {
    gifs: Record<string, { format: number; src: string; width: number; height: number; order: number; }>;
}

/** Same class modules FavoriteMedia reuses so folders look like Discord's own GIF categories. */
export const GifCategoryClasses = findCssClassesLazy("container", "categoryFade", "categoryName", "categoryText");
export const ScrollerClasses = findCssClassesLazy("thin", "scrollerBase", "scrollbarGutterStable");
export const GifResultClasses = findCssClassesLazy("result", "emptyHints", "emptyHintText", "gif");

const frecency = () => UserSettingsActionCreators.FrecencyUserSettingsActionCreators;

function toNativeGifs(gifs: FavoriteGifsProto["gifs"]): NativeGif[] {
    return Object.entries(gifs)
        // Items with format 0 are files stored by FavoriteAnything, not GIFs.
        .filter(([, gif]) => gif.format !== 0)
        .sort(([, a], [, b]) => b.order - a.order)
        .map(([url, gif]) => ({ url, src: gif.src, width: gif.width, height: gif.height }));
}

/**
 * Discord's favourite GIFs, kept live. They are synced across devices but only fetched
 * on demand, so ask Discord for the latest list and follow its updates.
 * Returns null while the list has not been loaded yet.
 */
export function useNativeGifs(enabled: boolean): NativeGif[] | null {
    useEffect(() => {
        if (enabled) void Promise.resolve(frecency().loadIfNecessary?.()).catch(() => undefined);
    }, [enabled]);
    const readGifs = () => (UserSettingsProtoStore.frecencyWithoutFetchingLatest?.favoriteGifs?.gifs ?? null) as FavoriteGifsProto["gifs"] | null;
    // A string signature: the proto object may be updated in place, which a reference check would miss.
    const signature = useStateFromStores([UserSettingsProtoStore], () => {
        if (!enabled) return null;
        const gifs = readGifs();
        return gifs ? Object.entries(gifs).map(([url, gif]) => `${url} ${gif.src} ${gif.order}`).join("\n") : null;
    });
    return useMemo(() => {
        const gifs = signature === null ? null : readGifs();
        return gifs ? toNativeGifs(gifs) : null;
    }, [signature]);
}

type NativeGifFn = (arg: unknown) => unknown;
let nativeGifFns: { favorite?: NativeGifFn; unfavorite?: NativeGifFn; } | null = null;

/**
 * Discord's own "add/remove favourite GIF" functions, the ones its star button calls.
 * FavoriteMedia uses them too: they normalise the key, respect the limit and show Discord's own errors.
 */
function getNativeGifFns() {
    if (nativeGifFns?.favorite && nativeGifFns.unfavorite) return nativeGifFns;
    const found = [...new Set(findAll(module => typeof module === "function" && String(module).includes('updateAsync("favoriteGifs')))] as NativeGifFn[];
    const favorite = found.find(fn => String(fn).includes("order")) ?? found[1];
    const unfavorite = found.find(fn => fn !== favorite) ?? found[0];
    nativeGifFns = { favorite, unfavorite };
    return nativeGifFns;
}

/** Adds or removes a link in Discord's own favourite GIF list so it stays in sync across devices. */
/**
 * Removes a GIF from Discord's favourites under every form of its link: Discord may have stored
 * it as media.discordapp.net while MediaVault knows it as cdn.discordapp.com, with other signatures.
 */
async function removeNativeGif(url: string): Promise<boolean> {
    const key = canonicalUrl(url);
    try {
        await frecency().updateAsync("favoriteGifs", (proto: FavoriteGifsProto) => {
            for (const storedUrl of Object.keys(proto.gifs ?? {})) {
                if (storedUrl === url || canonicalUrl(storedUrl) === key) delete proto.gifs[storedUrl];
            }
        }, UserSettingsDelay.INFREQUENT_USER_ACTION);
        return true;
    } catch (error) {
        console.warn("[MediaVault] Could not remove the GIF from Discord's favorites.", error);
        notify(t("toast.favoriteFailed"), true);
        return false;
    }
}

export async function setNativeGif(media: Pick<SavedMedia, "url" | "previewUrl" | "width" | "height">, enabled: boolean): Promise<boolean> {
    if (!enabled) return removeNativeGif(media.url);
    const src = media.previewUrl ?? media.url;
    const format = /\.(gif|webp|avif|png|jpe?g)(\?|$)/i.test(src) ? 1 : 2;
    try {
        const fns = getNativeGifFns();
        if (enabled && fns.favorite) {
            await fns.favorite({ format, url: media.url, src, width: media.width ?? 200, height: media.height ?? 110 });
            return true;
        }
        if (!enabled && fns.unfavorite) {
            await fns.unfavorite(media.url);
            return true;
        }
    } catch (error) {
        console.warn("[MediaVault] Discord's favorite GIF functions failed, writing directly.", error);
    }
    try {
        await frecency().updateAsync("favoriteGifs", (proto: FavoriteGifsProto) => {
            proto.gifs ??= {};
            if (!enabled) {
                delete proto.gifs[media.url];
                return;
            }
            const order = Math.max(0, ...Object.values(proto.gifs).map(gif => gif.order)) + 1;
            proto.gifs[media.url] = { format, src, width: media.width ?? 200, height: media.height ?? 110, order };
        }, UserSettingsDelay.INFREQUENT_USER_ACTION);
        return true;
    } catch (error) {
        console.warn("[MediaVault] Could not update Discord's favorite GIFs.", error);
        notify(t("toast.nativeGifFailed"), true);
        return false;
    }
}

function pressEnter() {
    window.setTimeout(() => {
        const input = document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]');
        input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", charCode: 13, keyCode: 13, bubbles: true }));
    }, 30);
}

export type NativeSelect = (item: { url: string; }, options?: { shiftKey: boolean; }) => void;

const PROBED_HOSTS = /^https:\/\/((cdn|media)\.discordapp\.(com|net)|media\d*\.tenor\.com|[a-z0-9-]+\.klipy\.com)\//i;

/** True when the link (or the file behind a Tenor page) is definitely gone. */
async function isLinkDead(item: SavedMedia, freshUrl: string): Promise<boolean> {
    if (needsRefresh(freshUrl)) return true;
    const probe = archiveSource({ url: freshUrl, previewUrl: item.previewUrl });
    if (!PROBED_HOSTS.test(probe)) return false;
    try {
        const response = await fetch(await refreshUrl(probe), { method: "HEAD" });
        return response.status === 404 || response.status === 403 || response.status === 410;
    } catch {
        return false;
    }
}

async function uploadBlob(blob: Blob, item: SavedMedia, shiftKey: boolean): Promise<boolean> {
    const channelId = SelectedChannelStore.getChannelId();
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!channel) return false;
    const name = fileNameFor(item.name, archiveSource(item), blob.type);
    await UploadHandler.promptToUpload([new File([blob], name, { type: blob.type || "application/octet-stream" })], channel, DraftType.ChannelMessage);
    if (settings.store.alwaysSendInstantly) pressEnter();
    if (!shiftKey) ExpressionPickerStore.closeExpressionPicker();
    return true;
}

/** Sends, inserts or uploads a saved media according to the settings. */
export async function chooseMedia(item: SavedMedia, onSelect: NativeSelect | undefined, shiftKey: boolean, forceLocal = false) {
    if (forceLocal) {
        const copy = await getArchive(item).catch(() => undefined);
        if (copy && await uploadBlob(copy, item, shiftKey).catch(() => false)) return;
        notify(t("toast.noLocalCopy"), true);
        return;
    }
    const url = await refreshUrl(item.url);
    const mustUpload = item.kind === "audio" || !!(settings.store as Record<string, unknown>)[`${item.kind}AlwaysUploadFile`];

    const archived = await getArchive(item).catch(() => undefined);
    if (archived && (mustUpload || await isLinkDead(item, url))) {
        if (await uploadBlob(archived, item, shiftKey).catch(() => false)) return;
    }

    if (mustUpload) {
        try {
            const response = await fetch(originalFileUrl(url));
            if (!response.ok) throw new Error(`Download failed (${response.status})`);
            if (await uploadBlob(await response.blob(), item, shiftKey)) return;
        } catch (error) {
            console.warn("[MediaVault] Attachment upload failed, the link will be inserted.", error);
            showToast({ text: t("toast.uploadFailed"), variant: "critical" });
        }
    }

    if (settings.store.alwaysSendInstantly && onSelect) {
        onSelect({ url }, { shiftKey });
        return;
    }
    ComponentDispatch.dispatchToLastSubscribed("INSERT_TEXT", { rawText: url, plainText: url });
    if (settings.store.alwaysSendInstantly) pressEnter();
    if (!shiftKey) ExpressionPickerStore.closeExpressionPicker();
}

export function notify(text: string, failure = false) {
    showToast({ text, variant: failure ? "critical" : "success" });
}

