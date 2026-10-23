/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    replaceNativeGifFavorites: {
        type: OptionType.BOOLEAN,
        description: "Replace the Favorites view of Discord's GIF picker with the MediaVault panel (folders, search, pages).",
        default: true
    },
    showImageTab: { type: OptionType.BOOLEAN, description: "Show the Images tab.", default: true },
    showVideoTab: { type: OptionType.BOOLEAN, description: "Show the Videos tab.", default: true },
    showAudioTab: { type: OptionType.BOOLEAN, description: "Show the Audio tab.", default: true },
    showFileTab: { type: OptionType.BOOLEAN, description: "Show the Files tab.", default: true },
    hideUnsortedMedias: {
        type: OptionType.BOOLEAN,
        description: "Hide media that are already filed in a folder from the root view.",
        default: true
    },
    hideThumbnail: {
        type: OptionType.BOOLEAN,
        description: "Show the folder color instead of a thumbnail.",
        default: false
    },
    cachePreviews: {
        type: OptionType.BOOLEAN,
        description: "Keep a local copy of previews so they still display after a Discord link has expired.",
        default: true
    },
    archiveMode: {
        type: OptionType.SELECT,
        description: "Keep a local copy of the files themselves so they can be sent again even if the original link disappears.",
        options: [
            { label: "GIFs only", value: "gif", default: true },
            { label: "GIFs, images and videos", value: "visual" },
            { label: "Disabled", value: "none" }
        ]
    },
    starAlwaysVisible: {
        type: OptionType.BOOLEAN,
        description: "Keep the MediaVault star always visible on images and videos in messages, without hovering.",
        default: true
    },
    mirrorToDisk: {
        type: OptionType.BOOLEAN,
        description: "Desktop only: also save every local copy as a real file in Pictures/MediaVault, with its proper name and format.",
        default: true
    },
    showImageButton: { type: OptionType.BOOLEAN, description: "Show the Images button in the chat bar.", default: true },
    showVideoButton: { type: OptionType.BOOLEAN, description: "Show the Videos button in the chat bar.", default: true },
    showAudioButton: { type: OptionType.BOOLEAN, description: "Show the Audio button in the chat bar.", default: true },
    showFileButton: { type: OptionType.BOOLEAN, description: "Show the Files button in the chat bar.", default: true },
    showImageStar: { type: OptionType.BOOLEAN, description: "Show the star on images in messages.", default: true },
    showVideoStar: { type: OptionType.BOOLEAN, description: "Show the star on videos in messages.", default: true },
    showAudioStar: { type: OptionType.BOOLEAN, description: "Show the star on audio files in messages.", default: true },
    showFileStar: { type: OptionType.BOOLEAN, description: "Show the star on other attachments in messages.", default: true },
    alwaysSendInstantly: {
        type: OptionType.BOOLEAN,
        description: "Send a media as soon as it is clicked. Otherwise only its link is inserted in the message. Shift+click keeps the picker open.",
        default: true
    },
    gifAlwaysUploadFile: { type: OptionType.BOOLEAN, description: "Send GIFs as attached files instead of links.", default: false },
    imageAlwaysUploadFile: { type: OptionType.BOOLEAN, description: "Send images as attached files instead of links.", default: false },
    videoAlwaysUploadFile: { type: OptionType.BOOLEAN, description: "Send videos as attached files instead of links.", default: false },
    fileAlwaysUploadFile: { type: OptionType.BOOLEAN, description: "Send files as attachments instead of links.", default: false },
    mediaVolume: {
        type: OptionType.SLIDER,
        description: "Volume of audio and video previews in MediaVault.",
        markers: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
        default: 10
    },
    maxMediasPerPage: {
        type: OptionType.SELECT,
        description: "Maximum number of folders and media per page.",
        options: [
            { label: "20", value: 20 },
            { label: "50", value: 50, default: true },
            { label: "100", value: 100 }
        ]
    }
});
