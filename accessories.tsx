/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, useStateFromStores, UserStore } from "@webpack/common";
import type { ReactNode } from "react";

import { isSaved, MediaInput, starEnabledFor, toggleSavedMedia } from "./actions";
import { AttachmentContext, AttachmentItem, EmbedContext, EmbedMosaicContext, ImageUtils, notify, transformAttachment } from "./discord";
import { t } from "./i18n";
import { inferKind } from "./model";
import { settings } from "./settings";
import { useLibrary } from "./store";

function StarIcon({ filled }: { filled: boolean; }) {
    return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" d={filled
            ? "M10.81 2.86c.38-1.15 2-1.15 2.38 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82a1.25 1.25 0 0 1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6a1.25 1.25 0 0 1 .73-2.25h6.12l1.9-5.83Z"
            : "M2.07 10.94a1.25 1.25 0 0 1 .73-2.25h6.12l1.9-5.83c.37-1.15 2-1.15 2.37 0l1.89 5.83h6.12c1.2 0 1.71 1.54.73 2.25l-4.95 3.6 1.9 5.82a1.25 1.25 0 0 1-1.93 1.4L12 18.16l-4.95 3.6c-.98.7-2.3-.25-1.92-1.4l1.89-5.82-4.95-3.6Zm11.55-.25h5.26l-4.25 3.09 1.62 5-4.25-3.1-4.25 3.1 1.62-5-4.25-3.1h5.26l1.62-5 1.62 5Z"}
            fillRule={filled ? undefined : "evenodd"} />
    </svg>;
}

/**
 * Star button. In messages it toggles the favourite; inside the panel (onRemove given) the media is a
 * favourite by definition, so the star only removes it, as in FavoriteMedia.
 */
export function FavoriteStarButton({ media, className = "", onRemove }: { media: MediaInput; className?: string; onRemove?: () => Promise<void>; }) {
    const accountId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const { library } = useLibrary(accountId);
    const [busy, setBusy] = React.useState(false);
    const { starAlwaysVisible } = settings.use(["starAlwaysVisible"]);
    const [optimistic, setOptimistic] = React.useState<boolean | null>(null);

    const saved = onRemove ? optimistic ?? true : optimistic ?? (library ? library.items.some(item => isSameMedia(item.url, media.url)) : false);

    React.useEffect(() => setOptimistic(null), [library]);

    async function onClick(event: React.MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (!accountId || busy) return;
        setBusy(true);
        try {
            if (onRemove) {
                await onRemove();
                setOptimistic(false);
            } else {
                setOptimistic(await toggleSavedMedia(accountId, media));
            }
        } catch (error) {
            console.error("[MediaVault] Could not update the favorite", error);
            notify(t("toast.favoriteFailed"), true);
        } finally {
            setBusy(false);
        }
    }

    if (!accountId || !media.url) return null;
    const label = saved ? t("star.remove") : t("star.add");
    return <button type="button" className={`vc-mediavault-star ${className} ${saved ? "is-saved" : ""} ${starAlwaysVisible ? "vc-mediavault-star-always" : ""}`} aria-label={label} title={label} aria-pressed={saved} disabled={busy} onClick={onClick}>
        <StarIcon filled={saved} />
    </button>;
}

function isSameMedia(a: string, b: string) {
    return a === b || stripQuery(a) === stripQuery(b);
}

const stripQuery = (url: string) => url.split(/[?#]/, 1)[0];

function kindOf(item: AttachmentItem) {
    const { type, originalItem } = item;
    if (type === "VIDEO" || type === "CLIP") return "video" as const;
    if (type === "AUDIO") return "audio" as const;
    if (type === "IMAGE") return inferKind(item.downloadUrl, originalItem.content_type, originalItem.filename);
    return "file" as const;
}

export function AttachmentAccessory() {
    const attachment = React.useContext(AttachmentContext);
    if (!attachment?.downloadUrl) return null;
    const { originalItem, downloadUrl, srcIsAnimated } = attachment;
    // Discord already puts its own favourite star on animated images.
    if (ImageUtils.isAnimated({ original: originalItem.url, src: originalItem.proxy_url, animated: false, srcIsAnimated })) return null;
    const kind = kindOf(attachment);
    if (!starEnabledFor(kind)) return null;
    return <div className="vc-mediavault-attachment-accessory">
        <FavoriteStarButton media={{ url: downloadUrl, previewUrl: originalItem.proxy_url, name: originalItem.filename, kind, contentType: originalItem.content_type, width: attachment.width, height: attachment.height }} />
    </div>;
}

interface ComponentFile {
    id: string;
    size: number;
    name: string;
    spoiler: boolean;
    file: { url: string; proxyUrl: string; width: number; height: number; contentType: string; };
}

export function AttachmentContextProvider({ attachment, component, children }: {
    attachment?: AttachmentItem;
    component?: ComponentFile;
    children: ReactNode;
}) {
    const value = React.useMemo<AttachmentItem | null>(() => {
        if (component) {
            const { id, size, name, spoiler, file } = component;
            return transformAttachment({ ...file, size, filename: name, id, spoiler, content_type: file.contentType, proxy_url: file.proxyUrl } as never);
        }
        if (!attachment) return null;
        const { originalItem, ...rest } = attachment;
        // Media gallery attachments (components v2) are shaped differently from regular ones.
        if ("media" in originalItem) {
            const media = (originalItem as unknown as { media: { url: string; proxyUrl: string; contentType: string; width: number; height: number; }; }).media;
            return {
                ...rest,
                originalItem: { ...media, id: rest.uniqueId, size: 0, spoiler: rest.spoiler, filename: (rest.spoiler ? "SPOILER_" : "") + rest.uniqueId, content_type: media.contentType, proxy_url: media.proxyUrl } as never
            };
        }
        return attachment;
    }, [attachment, component]);

    return <AttachmentContext.Provider value={value}>{children}</AttachmentContext.Provider>;
}

export function EmbedAccessory() {
    const embed = React.useContext(EmbedContext);
    const mosaicIndex = React.useContext(EmbedMosaicContext);
    if (!embed || embed.type === "gifv") return null;
    const { video, image, images, thumbnail } = embed;

    if (video) {
        // Third party videos have no proxied file, so the embed page is the only usable link.
        const proxied = !!video.proxyURL;
        const url = proxied ? video.url : embed.url;
        if (!url || !starEnabledFor("video")) return null;
        return <div className="vc-mediavault-embed-accessory">
            <FavoriteStarButton media={{ url, previewUrl: video.proxyURL ?? thumbnail?.proxyURL, name: embed.title ?? t("name.video"), kind: "video", width: video.width, height: video.height, sourceUrl: embed.url }} />
        </div>;
    }

    const img = (mosaicIndex != null && images?.[mosaicIndex]) || image;
    if (!img?.url) return null;
    if (ImageUtils.isAnimated({ ...img, original: img.url, src: img.proxyURL ?? img.url, animated: false })) return null;
    const kind = inferKind(img.url, "image/*");
    if (!starEnabledFor(kind)) return null;
    return <div className="vc-mediavault-embed-accessory">
        <FavoriteStarButton media={{ url: img.url, previewUrl: img.proxyURL, name: embed.title ?? t("name.image"), kind, width: img.width, height: img.height, sourceUrl: embed.url }} />
    </div>;
}
