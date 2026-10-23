/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addChatBarButton, ChatBarButton, removeChatBarButton } from "@api/ChatButtons";
import definePlugin from "@utils/types";
import { ExpressionPickerStore, React } from "@webpack/common";
import type { ComponentType, ReactNode } from "react";

import { AttachmentAccessory, AttachmentContextProvider, EmbedAccessory } from "./accessories";
import { disposeCache } from "./cache";
import { Key, t } from "./i18n";
import { ChatIcon } from "./cards";
import { EmbedContext, EmbedMosaicContext, NativeSelect } from "./discord";
import { gifPickerMenu, imageMenu, messageMenu } from "./menus";
import { MediaKind } from "./model";
import { MediaPanel } from "./panel";
import { settings } from "./settings";
import managedStyle from "./style.css?managed";
import { resetUrlQueue } from "./urls";

const VIEWS = {
    "mv-image": "image",
    "mv-video": "video",
    "mv-audio": "audio",
    "mv-file": "file"
} as const satisfies Record<string, MediaKind>;

type VaultView = keyof typeof VIEWS;

const TAB_SETTINGS = {
    "mv-image": "showImageTab",
    "mv-video": "showVideoTab",
    "mv-audio": "showAudioTab",
    "mv-file": "showFileTab"
} as const satisfies Record<VaultView, string>;

const ICONS: Record<VaultView, "image" | "video" | "audio" | "file"> = {
    "mv-image": "image",
    "mv-video": "video",
    "mv-audio": "audio",
    "mv-file": "file"
};

interface TabProps {
    id?: string;
    "aria-controls"?: string;
    "aria-selected"?: boolean;
    isActive?: boolean;
    viewType: string;
    children?: ReactNode;
}

interface GifPickerInstance {
    state?: { resultType?: string | null; };
    props: { onSelectGIF?: NativeSelect; };
}

const isVaultView = (view: string): view is VaultView => view in VIEWS;

const BUTTON_SETTINGS = {
    "mv-image": "showImageButton",
    "mv-video": "showVideoButton",
    "mv-audio": "showAudioButton",
    "mv-file": "showFileButton"
} as const satisfies Record<VaultView, string>;

function VaultChatButton({ view, channelId, type, isMainChat }: { view: VaultView; channelId: string; type: unknown; isMainChat: boolean; }) {
    const key = BUTTON_SETTINGS[view];
    const visible = settings.use([key])[key];
    if (!visible || !isMainChat) return null;
    return <ChatBarButton tooltip={t(`button.${VIEWS[view]}` as Key)} onClick={() => ExpressionPickerStore.toggleExpressionPicker(view, type, channelId)}>
        <ChatIcon type={ICONS[view]} />
    </ChatBarButton>;
}

export default definePlugin({
    name: "MediaVault",
    description: "Favorites library for GIFs, images, videos, audio and files, with folders, search, local copies and automatically renewed links.",
    authors: [{ name: "MediaVault", id: 0n }],
    dependencies: ["ChatInputButtonAPI", "ContextMenuAPI"],
    settings,
    managedStyle,

    patches: [
        // Tabs and panels in the expression picker. Same anchors as FavoriteAnything.
        {
            find: "#{intl::EXPRESSION_PICKER_CATEGORIES_A11Y_LABEL}",
            replacement: [
                {
                    match: /\(0,\i\.jsx\)\((\i),[^}]{20,40}?"aria-selected":(\i)[^}]{50,100}?#{intl::EXPRESSION_PICKER_GIF}\)\}\)/,
                    replace: "$self.renderTabs($1,$2)"
                },
                {
                    match: /\{onSelectGIF:(\i),[^}]{20,40}\}\):null,(?=(\i)===)/,
                    replace: "$&$self.renderMediaViews($2,$1),"
                }
            ]
        },
        // The GIF picker's "Favorites" view becomes the MediaVault panel.
        {
            find: "renderHeaderContent()",
            replacement: {
                match: "renderContent(){",
                replace: "renderContent(){return $self.renderGifFavorites(this,this.__renderContent())}__renderContent(){"
            }
        },
        // Star on embeds.
        {
            find: "this.renderInlineMediaEmbed",
            replacement: [
                {
                    match: "render()",
                    replace: "$&{return $self.renderEmbed(this)}__render()"
                },
                {
                    match: /\.images\.map\((\i)=>(this.renderImage\(\{[^}]{50,100}\}\))\)/,
                    replace: ".images.map(($1,index)=>$self.renderEmbedMosaicItem($2,index))"
                }
            ]
        },
        {
            find: "#{intl::MEDIA_MOSAIC_ALT_TEXT_POPOUT_TITLE}",
            replacement: {
                match: /renderAdjacentContent:\i/g,
                replace: "$&=$self.renderEmbedAccessory"
            }
        },
        // Star on attachments.
        {
            find: '["VIDEO","CLIP","AUDIO"]',
            replacement: [
                {
                    match: /(?<=children:)(\i)=>(\i\(\1\))\}\):(\i\(\))/,
                    replace: "$1=>$self.renderAttachment($2,arguments[0])}):$self.renderAttachment($3,arguments[0])"
                },
                {
                    match: /let \i=Math.max\(0,(\i)\.length-\i\)/,
                    replace: "$1.unshift($self.renderAttachmentAccessory());$&"
                }
            ]
        },
        {
            find: "#{intl::ATTACHMENT_FILENAME_UNKNOWN}",
            replacement: {
                match: /(?<=case \i\.\i\.FILE:)return(\(0,\i\.jsx\)\(\i,\{\.\.\.(\i)\},(\i)\))/,
                replace: "return $self.renderComponentFile($1,$3,$2)"
            }
        }
    ],

    contextMenus: {
        "message": messageMenu,
        "image-context": imageMenu,
        "gif-picker": gifPickerMenu
    },

    start() {
        for (const view of Object.keys(VIEWS) as VaultView[]) {
            addChatBarButton(`MediaVault-${VIEWS[view]}`, ({ channel, type, isMainChat }) => <VaultChatButton view={view} channelId={channel.id} type={type} isMainChat={isMainChat} />, () => <ChatIcon type={ICONS[view]} />);
        }
    },

    stop() {
        for (const kind of Object.values(VIEWS)) removeChatBarButton(`MediaVault-${kind}`);
        disposeCache();
        resetUrlQueue();
    },

    renderTabs(Tab: ComponentType<TabProps>, activeView: string) {
        return <>
            <Tab id="gif-picker-tab" key="gif-picker-tab" aria-controls="gif-picker-tab-panel" aria-selected={activeView === "gif"} isActive={activeView === "gif"} viewType="gif">
                {t("tab.gif")}
            </Tab>
            {(Object.keys(VIEWS) as VaultView[]).filter(view => settings.store[TAB_SETTINGS[view]]).map(view => <Tab id={`${view}-picker-tab`} key={`${view}-picker-tab`} aria-controls={`${view}-picker-tab-panel`} aria-selected={activeView === view} isActive={activeView === view} viewType={view}>
                {t(`tab.${VIEWS[view]}` as Key)}
            </Tab>)}
        </>;
    },

    renderMediaViews(activeView: string, onSelectGIF: NativeSelect) {
        if (!isVaultView(activeView)) return null;
        return <MediaPanel kind={VIEWS[activeView]} onSelect={onSelectGIF} />;
    },

    renderGifFavorites(picker: GifPickerInstance, original: ReactNode) {
        if (!settings.store.replaceNativeGifFavorites || picker.state?.resultType !== "Favorites" || !original) return original;
        const nativeSelect = (original as { props?: { onSelectGIF?: NativeSelect; }; }).props?.onSelectGIF ?? picker.props.onSelectGIF;
        return <MediaPanel kind="gif" syncNative onSelect={nativeSelect} />;
    },

    renderEmbed(component: { props: { embed: unknown; }; __render: () => ReactNode; }) {
        return <EmbedContext.Provider value={component.props.embed}>{component.__render()}</EmbedContext.Provider>;
    },

    renderEmbedMosaicItem(children: ReactNode, index: number) {
        return <EmbedMosaicContext.Provider value={index}>{children}</EmbedMosaicContext.Provider>;
    },

    renderAttachment(children: ReactNode, { item }: { item: React.ComponentProps<typeof AttachmentContextProvider>["attachment"]; }) {
        return <AttachmentContextProvider attachment={item}>{children}</AttachmentContextProvider>;
    },

    renderComponentFile(children: ReactNode, key: React.Key, component: React.ComponentProps<typeof AttachmentContextProvider>["component"]) {
        return <AttachmentContextProvider component={component} key={key}>{children}</AttachmentContextProvider>;
    },

    renderAttachmentAccessory: () => <AttachmentAccessory />,
    renderEmbedAccessory: () => <EmbedAccessory />
});
