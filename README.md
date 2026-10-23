# MediaVault

A favorites library for **Equicord / Vencord**: GIFs, images, videos, audio and files, with folders, search, pages and one-click sending. Inspired by [FavoriteMedia](https://github.com/Dastan21/BDAddons/tree/main/plugins/FavoriteMedia) for BetterDiscord, rebuilt as a source userplugin.

## Features

- **Favorites for every media type.** Star images, videos, audio and files in messages, or right-click a message and use the MediaVault menu. GIFs use Discord's own favorite GIFs, so they stay in sync across your devices.
- **Folders and subfolders** with colors and thumbnails, drag and drop, reordering, search and pages. Folders use the same look as Discord's own GIF categories.
- **Links that never expire.** Discord attachment links expire; MediaVault renews them in batches, uses the fresh link when sending and stores it again.
- **Local copies.** Previews and GIFs (optionally images and videos too) are copied locally. If the original link disappears, the local copy is sent as an attachment and used as the preview. A badge marks media that have a copy.
- **Real files on disk (desktop app).** Every copy is also saved in `Pictures/MediaVault/` (subfolders GIF, Images, Videos, Audio, Files) with its proper name and original format. The Database panel shows the folder, opens it and exports all existing copies.
- **Correct names and formats.** Files are fetched as originals (no WebP conversion by Discord's media proxy) and named with their real extension, whether saved, sent or exported.
- **FavoriteMedia import.** Import `FavoriteMedia.config.json` (BetterDiscord's `plugins` folder) directly, or a MediaVault export. Folders, subfolders, colors, thumbnails, names and message links are kept. Imports are merged: folders with the same name are combined and media already present are not duplicated.
- **Sending like FavoriteMedia.** Click to send through Discord's own handler, Shift+click keeps the picker open, optional "send as attachment" per type, optional "send immediately".
- **Chat bar buttons** with FavoriteMedia's icons, each one can be turned off separately in the settings. The Images, Videos, Audio and Files tabs can be hidden too.
- **Translated interface.** The panel follows Discord's language: English, French, Spanish, German, Italian, Portuguese, Dutch, Russian, Ukrainian, Polish, Turkish, Japanese, Korean and Chinese. Missing strings fall back to English. Settings and error messages are in English.

## Installation

MediaVault is a **source userplugin**, not a BetterDiscord plugin.

1. Close Discord.
2. Copy the `mediaVault` folder into `src/userplugins/` of your Equicord (or Vencord) checkout.
3. From the repository root run `pnpm build` (or `pnpm build --dev`), then restart Discord and enable **MediaVault**.

Disable `FavoriteAnything` and `GifCollections`: they patch the same parts of the expression picker and conflict with MediaVault. Data saved by MediaVault 3.0 is read as is.

## Adding a language

Open `i18n.ts`, copy one of the dictionaries, translate the values and register it in the `dictionaries` object. Keys that are missing fall back to English.

## Status

Checked against the Equicord repository at commit `17068a9` (October 22, 2026):

- the whole repository type-checks (`tsc --noEmit`) with the plugin included;
- `pnpm buildStandalone` builds and bundles the plugin, including its native helper;
- `lint:patches` reports nothing;
- the model tests pass (`node tests/model.test.cjs`);
- the patch anchors for tabs, embeds, attachments and components v2 are the same as the ones used by `FavoriteAnything` in the same commit.

Not yet tested in a live Discord session. A patch that no longer matches Discord's bundle only disables the feature it belongs to. The one to watch is the takeover of the GIF picker's Favorites view, which relies on the picker's `renderContent()` method; if it does not show up, turn off "Replace the Favorites view of Discord's GIF picker" and the other tabs keep working.

Intentional differences from FavoriteMedia: no "download a whole folder to disk" (use the local copies folder instead).

## Credits and license

Inspired by [Dastan21/BDAddons, FavoriteMedia](https://github.com/Dastan21/BDAddons/tree/main/plugins/FavoriteMedia). Patch anchors and the URL renewal logic follow the `FavoriteAnything` and `GifCollections` plugins of Equicord.

License: GNU GPL v3 or later. See `LICENSE`.
