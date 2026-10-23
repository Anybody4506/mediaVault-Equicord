/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Menu } from "@webpack/common";

import { addMedia, currentAccountId, downloadMedia, getMediaFromMessage, makeMedia, MediaInput, toggleSavedMedia } from "./actions";
import { notify } from "./discord";
import { t } from "./i18n";
import { canonicalUrl, mediaNameFromUrl, SavedMedia } from "./model";

function copy(text: string) {
    void navigator.clipboard.writeText(text).then(() => notify(t("toast.copied")));
}

function mediaItems(media: MediaInput, prefix: string) {
    const prepared = makeMedia(media);
    if (!prepared) return null;
    return <>
        <Menu.MenuItem id={`${prefix}-toggle`} label={t("menu.toggle")} action={() => {
            const accountId = currentAccountId();
            if (accountId) void toggleSavedMedia(accountId, media).catch(error => console.error("[MediaVault]", error));
        }} />
        <Menu.MenuItem id={`${prefix}-copy`} label={t("menu.copyLink")} action={() => copy(media.url)} />
        <Menu.MenuItem id={`${prefix}-download`} label={t("menu.download")} action={() => void downloadMedia(prepared as SavedMedia)} />
    </>;
}

export const messageMenu: NavContextMenuPatchCallback = (children, props) => {
    const message = (props as { message?: Parameters<typeof getMediaFromMessage>[0]; }).message;
    const media = getMediaFromMessage(message);
    if (!media.length) return;
    children.push(<Menu.MenuItem key="vc-mediavault-message" id="vc-mediavault-message" label="MediaVault">
        <Menu.MenuItem id="vc-mediavault-save-all" label={media.length === 1 ? t("menu.addOne") : t("menu.addMany", { count: media.length })} action={() => {
            const accountId = currentAccountId();
            if (!accountId) return;
            void Promise.all(media.map(item => addMedia(accountId, item))).then(() => notify(t("toast.added"))).catch(error => console.error("[MediaVault]", error));
        }} />
        {media.slice(0, 10).map((item, index) => <Menu.MenuItem key={canonicalUrl(item.url)} id={`vc-mediavault-media-${index}`} label={item.name.slice(0, 48) || mediaNameFromUrl(item.url)}>
            {mediaItems(item, `vc-mediavault-media-${index}`)}
        </Menu.MenuItem>)}
    </Menu.MenuItem>);
};

export const imageMenu: NavContextMenuPatchCallback = (children, props) => {
    const context = props as { src?: string; itemSrc?: string; itemHref?: string; };
    const url = context.itemHref ?? context.itemSrc ?? context.src;
    if (!url) return;
    const items = mediaItems({ url }, "vc-mediavault-image");
    if (!items) return;
    children.push(<Menu.MenuItem key="vc-mediavault-image" id="vc-mediavault-image" label="MediaVault">{items}</Menu.MenuItem>);
};

export const gifPickerMenu: NavContextMenuPatchCallback = (children, props) => {
    const { url, src, width, height } = props as { url?: string; src?: string; width?: number; height?: number; };
    if (!url) return;
    const items = mediaItems({ url, previewUrl: src, kind: "gif", width, height }, "vc-mediavault-gif");
    if (!items) return;
    children.push(<Menu.MenuItem key="vc-mediavault-gif" id="vc-mediavault-gif" label="MediaVault">{items}</Menu.MenuItem>);
};
