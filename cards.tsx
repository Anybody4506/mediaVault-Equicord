/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React } from "@webpack/common";
import type { ReactNode } from "react";

import { useMediaSrc } from "./cache";
import { FavoriteStarButton } from "./accessories";
import { t } from "./i18n";
import { GifCategoryClasses, GifResultClasses } from "./discord";
import { isVideoUrl, MediaCategory, SavedMedia } from "./model";
import { settings } from "./settings";
import { useFreshUrl } from "./urls";

type IconName = "search" | "back" | "database" | "import" | "export" | "settings" | "folder" | "file" | "audio" | "video" | "image" | "play" | "download" | "copy" | "plus" | "left" | "right";

export function Icon({ name }: { name: IconName; }) {
    const paths: Record<IconName, ReactNode> = {
        search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
        back: <path d="M19 12H5m0 0 7-7m-7 7 7 7" />,
        database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
        import: <><path d="M12 3v12m0 0 5-5m-5 5-5-5" /><path d="M5 16v4h14v-4" /></>,
        export: <><path d="M12 15V3m0 0 5 5m-5-5-5 5" /><path d="M5 16v4h14v-4" /></>,
        settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
        folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />,
        file: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
        audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
        video: <><rect x="3" y="5" width="13" height="14" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>,
        image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
        play: <path d="m8 5 12 7-12 7z" />,
        download: <><path d="M12 3v12m0 0 5-5m-5 5-5-5" /><path d="M5 17v4h14v-4" /></>,
        copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
        plus: <path d="M12 5v14M5 12h14" />,
        left: <path d="m15 18-6-6 6-6" />,
        right: <path d="m9 18 6-6-6-6" />
    };
    return <svg className="mv-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

/** True while the element is on screen (with a margin), so only visible GIFs play. */
function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
    const [visible, setVisible] = React.useState(false);
    React.useEffect(() => {
        const element = ref.current;
        if (!element) return;
        const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "200px" });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref.current]);
    return visible;
}

function Thumbnail({ url, archived, className, animate, onHoverPlay }: {
    url: string | undefined;
    archived?: Pick<SavedMedia, "url" | "previewUrl">;
    className: string;
    animate: boolean;
    onHoverPlay?: boolean;
}) {
    const { src, type, onError, failed } = useMediaSrc(url, archived);
    const boxRef = React.useRef<HTMLDivElement>(null);
    const videoRef = React.useRef<HTMLVideoElement>(null);
    const visible = useOnScreen(boxRef);

    // Browsers can only play a limited number of videos at once: pause the ones that scrolled away.
    React.useEffect(() => {
        const video = videoRef.current;
        if (!video || !animate) return;
        if (visible) void video.play().catch(() => undefined);
        else video.pause();
    }, [visible, animate, src]);

    if (failed) return <div ref={boxRef} className={`${className} mv-preview-missing`} title={t("card.unavailable")}><Icon name="image" /></div>;
    // The real content type wins over the link: many GIF links have no extension or point to an MP4.
    const asVideo = type ? type.startsWith("video/") : isVideoUrl(url);
    return <div ref={boxRef} className="mv-preview-box">
        {src && (visible || !animate) && (asVideo
            ? <video ref={videoRef} className={className} src={!animate && !src.startsWith("blob:") && !src.includes("#") ? `${src}#t=0.1` : src}
                muted loop playsInline draggable={false} autoPlay={animate} preload={animate ? "auto" : "metadata"} onError={onError}
                onMouseEnter={onHoverPlay ? event => { void event.currentTarget.play().catch(() => undefined); } : undefined}
                onMouseLeave={onHoverPlay ? event => event.currentTarget.pause() : undefined} />
            : <img className={className} src={src} loading="lazy" draggable={false} onError={onError} />)}
    </div>;
}

function readableOn(hex: string): string {
    const value = parseInt(hex.replace("#", ""), 16);
    const brightness = (((value >> 16) & 255) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000;
    return brightness > 125 ? "black" : "white";
}

export function CategoryFolder({ category, thumbnail, style, onOpen, onContextMenu, onDragStart, dragProps }: {
    category: MediaCategory;
    thumbnail?: string;
    style: React.CSSProperties;
    onOpen: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
    onDragStart: (event: React.DragEvent) => void;
    dragProps: Record<string, unknown>;
}) {
    const color = category.color ?? "#202225";
    const showColor = !thumbnail || settings.store.hideThumbnail;
    const native = !!(GifCategoryClasses.categoryFade && GifCategoryClasses.categoryText && GifCategoryClasses.categoryName && GifResultClasses.result);
    const common = {
        role: "button",
        tabIndex: 0,
        title: category.name,
        "aria-label": t("folder.openAria", { name: category.name }),
        onClick: onOpen,
        onContextMenu,
        onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } },
        draggable: true,
        onDragStart,
        ...dragProps
    };

    // Same markup as Discord's GIF categories and FavoriteMedia: colour or image, fade, centred name.
    if (native) return <div className={`${GifResultClasses.result} mv-result mv-category-native`} style={style} {...common}>
        <div className={GifCategoryClasses.categoryFade} style={showColor ? { backgroundColor: color } : undefined} />
        <div className={GifCategoryClasses.categoryText}>
            <span className={GifCategoryClasses.categoryName} style={showColor ? { color: readableOn(color), textShadow: "none" } : undefined}>{category.name}</span>
        </div>
        {!showColor && <Thumbnail url={thumbnail} className={`${GifResultClasses.gif ?? ""} mv-category-media`} animate={false} />}
    </div>;

    // Fallback if Discord renames those classes.
    return <div className="mv-result mv-category" style={{ ...style, "--mv-folder-color": color } as React.CSSProperties} {...common}>
        <div className="mv-category-image">
            {!showColor && <Thumbnail url={thumbnail} className="mv-category-media" animate={false} />}
        </div>
        <div className="mv-category-fade" />
        <div className="mv-category-label">
            <span className="mv-category-glyph"><Icon name="folder" /></span>
            <span>{category.name}</span>
        </div>
    </div>;
}

export function MediaCard({ item, hasCopy, style, onSelect, onContextMenu, onDragStart, onRemove }: {
    item: SavedMedia;
    hasCopy: boolean;
    onRemove: () => Promise<void>;
    style: React.CSSProperties;
    onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
    onContextMenu: (event: React.MouseEvent) => void;
    onDragStart: (event: React.DragEvent) => void;
}) {
    const [playing, setPlaying] = React.useState(false);
    const visual = item.kind === "gif" || item.kind === "image" || item.kind === "video";
    const previewUrl = item.previewUrl ?? item.url;
    const playable = useFreshUrl(playing ? item.url : undefined);
    const volume = (element: HTMLMediaElement) => { element.volume = Number(settings.store.mediaVolume ?? 10) / 100; };

    return <div className={`mv-result mv-media mv-kind-${item.kind}`} style={style} role="button" tabIndex={0} title={item.name}
        onClick={event => {
            if ((event.target as HTMLElement).closest("button,audio,video[controls]")) return;
            if (!playing) onSelect(event);
        }}
        onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && !playing) { event.preventDefault(); onSelect(event); } }}
        onContextMenu={onContextMenu} draggable onDragStart={onDragStart}>
        {visual && !playing && <Thumbnail url={previewUrl} archived={item} className="mv-media-preview" animate={item.kind === "gif"} onHoverPlay={item.kind === "video"} />}
        {item.kind === "video" && playing && playable && <video className="mv-media-preview mv-video-controls" src={playable} controls autoPlay playsInline
            onLoadedMetadata={event => volume(event.currentTarget)} onClick={event => event.stopPropagation()} />}
        {!visual && <div className="mv-file-preview"><Icon name={item.kind === "audio" ? "audio" : "file"} /><span>{item.kind === "audio" ? "AUDIO" : (item.name.split(".").pop() || "FICHIER").slice(0, 10).toUpperCase()}</span></div>}
        {item.kind === "audio" && playing && playable && <audio className="mv-audio-controls" src={playable} controls autoPlay onLoadedMetadata={event => volume(event.currentTarget)} onClick={event => event.stopPropagation()} />}
        <div className="mv-media-fade" />
        {hasCopy && <span className="mv-local-badge" title={t("card.localBadge")}><Icon name="download" /></span>}
        <div className="mv-media-title">{item.name}</div>
        <div className="mv-media-actions">
            {(item.kind === "audio" || item.kind === "video") && <button type="button" title={playing ? t("card.hideControls") : t("card.play")} aria-label={playing ? t("card.hideControls") : t("card.play")}
                onClick={event => { event.preventDefault(); event.stopPropagation(); setPlaying(value => !value); }}><Icon name={playing ? "back" : "play"} /></button>}
            <FavoriteStarButton onRemove={onRemove} media={{ url: item.url, previewUrl: item.previewUrl, name: item.name, kind: item.kind, width: item.width, height: item.height }} />
        </div>
    </div>;
}

/** The chat bar icons of FavoriteMedia. */
const CHAT_ICONS = {
    image: { viewBox: "0 0 384 384", paths: ["M341.333,0H42.667C19.093,0,0,19.093,0,42.667v298.667C0,364.907,19.093,384,42.667,384h298.667 C364.907,384,384,364.907,384,341.333V42.667C384,19.093,364.907,0,341.333,0z M42.667,320l74.667-96l53.333,64.107L245.333,192l96,128H42.667z"] },
    video: { viewBox: "0 0 298 298", paths: ["M298,33c0-13.255-10.745-24-24-24H24C10.745,9,0,19.745,0,33v232c0,13.255,10.745,24,24,24h250c13.255,0,24-10.745,24-24V33zM91,39h43v34H91V39z M61,259H30v-34h31V259z M61,73H30V39h31V73z M134,259H91v-34h43V259z M123,176.708v-55.417c0-8.25,5.868-11.302,12.77-6.783l40.237,26.272c6.902,4.519,6.958,11.914,0.056,16.434l-40.321,26.277C128.84,188.011,123,184.958,123,176.708z M207,259h-43v-34h43V259z M207,73h-43V39h43V73z M268,259h-31v-34h31V259z M268,73h-31V39h31V73z"] },
    audio: {
        viewBox: "0 0 115.3 115.3", paths: [
            "M47.9,14.306L26,30.706H6c-3.3,0-6,2.7-6,6v41.8c0,3.301,2.7,6,6,6h20l21.9,16.4c4,3,9.6,0.2,9.6-4.8v-77C57.5,14.106,51.8,11.306,47.9,14.306z",
            "M77.3,24.106c-2.7-2.7-7.2-2.7-9.899,0c-2.7,2.7-2.7,7.2,0,9.9c13,13,13,34.101,0,47.101c-2.7,2.7-2.7,7.2,0,9.899c1.399,1.4,3.199,2,4.899,2s3.601-0.699,4.9-2.1C95.8,72.606,95.8,42.606,77.3,24.106z",
            "M85.1,8.406c-2.699,2.7-2.699,7.2,0,9.9c10.5,10.5,16.301,24.4,16.301,39.3s-5.801,28.8-16.301,39.3c-2.699,2.7-2.699,7.2,0,9.9c1.4,1.399,3.2,2.1,4.9,2.1c1.8,0,3.6-0.7,4.9-2c13.1-13.1,20.399-30.6,20.399-49.2c0-18.6-7.2-36-20.399-49.2C92.3,5.706,87.9,5.706,85.1,8.406z"
        ]
    },
    file: { viewBox: "2 2 20 20", paths: ["M16,2l4,4H16ZM14,2H5A1,1,0,0,0,4,3V21a1,1,0,0,0,1,1H19a1,1,0,0,0,1-1V8H14Z"] }
} as const;

export function ChatIcon({ type }: { type: keyof typeof CHAT_ICONS; }) {
    const icon = CHAT_ICONS[type];
    return <svg className="mv-chat-icon" viewBox={icon.viewBox} width="24" height="24" aria-hidden="true">
        {icon.paths.map(d => <path key={d.slice(0, 16)} fill="currentColor" d={d} />)}
    </svg>;
}
