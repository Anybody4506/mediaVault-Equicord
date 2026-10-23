/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ContextMenuApi, Menu, React, useStateFromStores, UserStore } from "@webpack/common";

import { Key, t } from "./i18n";
import { downloadMedia, exportLibrary, removeSaved, saveLocalCopy, withoutRecentlyRemoved } from "./actions";
import { isUnavailable, archiveInBackground, archiveMedia, cacheKeys, getArchive, cacheMedia, cacheStats, clearCache, hasLocalCopy, migrateCache, onCacheChanged, pruneCache, shouldArchive } from "./cache";
import { CategoryFolder, Icon, MediaCard } from "./cards";
import { chooseMedia, NativeSelect, notify, ScrollerClasses, useNativeGifs } from "./discord";
import { canUseDisk, diskFolder, openDiskFolder, writeToDisk } from "./mirror";
import {
    deleteCategory, LibraryData, MediaCategory, MediaKind, mergeLibraries, moveCategory, moveCategoryOrder, moveMedia,
    ensureMedia, gifView, readImportedLibrary, renameMedia, replaceUrls, SavedMedia, setCategoryThumbnail, syncNativeGifs, upsertCategory, urlKey, withoutNativeGifs
} from "./model";
import { settings } from "./settings";
import { loadLibrary, updateLibrary, useLibrary } from "./store";
import { needsRefresh, refreshUrl } from "./urls";

const MEDIA_DRAG_TYPE = "application/x-vencord-mediavault-item";
const CATEGORY_DRAG_TYPE = "application/x-vencord-mediavault-category";
const GAP = 12;

const hasVisual = (kind: MediaKind) => kind === "gif" || kind === "image" || kind === "video";
const dragTypes = (event: React.DragEvent) => [...event.dataTransfer.types];
const isVaultDrag = (event: React.DragEvent) => dragTypes(event).some(type => type === MEDIA_DRAG_TYPE || type === CATEGORY_DRAG_TYPE);
const normalize = (text: string) => text.toLowerCase().replace(/[_-]/g, " ");

export function MediaPanel({ kind, onSelect, syncNative = false }: { kind: MediaKind; onSelect?: NativeSelect; syncNative?: boolean; }) {
    const accountId = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    if (!accountId) return <div className="mv-empty">{t("signIn")}</div>;
    return <Panel key={`${accountId}:${kind}`} accountId={accountId} kind={kind} onSelect={onSelect} syncNative={syncNative} />;
}

function Panel({ accountId, kind, onSelect, syncNative }: { accountId: string; kind: MediaKind; onSelect?: NativeSelect; syncNative: boolean; }) {
    const { library, error: loadError, reload } = useLibrary(accountId);
    const [error, setError] = React.useState("");
    const [search, setSearch] = React.useState("");
    const [activeCategory, setActiveCategory] = React.useState<string | null>(null);
    const [categoryDraft, setCategoryDraft] = React.useState<MediaCategory | null>(null);
    const [renameDraft, setRenameDraft] = React.useState<{ url: string; name: string; } | null>(null);
    const [showDatabase, setShowDatabase] = React.useState(false);
    const [showSettings, setShowSettings] = React.useState(false);
    const [, refreshSettings] = React.useState(0);
    const [cacheInfo, setCacheInfo] = React.useState<{ count: number; bytes: number; } | null>(null);
    const [caching, setCaching] = React.useState(false);
    const [folder, setFolder] = React.useState<string | null>(null);
    React.useEffect(() => { if (showDatabase && canUseDisk) void diskFolder().then(setFolder); }, [showDatabase]);
    const [page, setPage] = React.useState(1);
    const [busy, setBusy] = React.useState(false);
    const [width, setWidth] = React.useState(480);
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const canvasRef = React.useRef<HTMLDivElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const [localKeys, setLocalKeys] = React.useState<Set<string>>(() => new Set());
    React.useEffect(() => {
        let timer: number | undefined;
        const load = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void cacheKeys().then(setLocalKeys), 300); };
        void migrateCache().finally(load);
        const stop = onCacheChanged(load);
        return () => { stop(); window.clearTimeout(timer); };
    }, []);

    const nativeGifs = useNativeGifs(syncNative && kind === "gif");
    const nativeSignature = nativeGifs ? nativeGifs.map(gif => gif.url).join("|") : null;

    // Keep Discord's own favourite GIFs mirrored in the library, including ones added on other devices.
    // Nothing is removed until Discord has actually loaded the list.
    React.useEffect(() => {
        if (!nativeGifs) return;
        const favorites = withoutRecentlyRemoved(nativeGifs);
        const sync = (current: LibraryData) => favorites.length ? syncNativeGifs(current, favorites) : withoutNativeGifs(current);
        // Compare first: the library is only written (and every view reloaded) when Discord's list really changed.
        void loadLibrary(accountId)
            .then(current => sync(current) === current ? undefined : updateLibrary(accountId, sync))
            .catch(e => setError(e instanceof Error ? e.message : String(e)));
    }, [accountId, kind, nativeSignature]);

    // Quietly keep a local copy of every archivable favourite, a few at a time.
    const archiveSignature = (library?.items ?? []).filter(item => item.kind === kind && shouldArchive(item.kind)).map(item => item.url).join("|");
    React.useEffect(() => {
        if (library) archiveInBackground(library.items.filter(item => item.kind === kind));
    }, [archiveSignature]);

    React.useEffect(() => {
        const element = canvasRef.current;
        if (!element) return;
        setWidth(element.clientWidth || 480);
        const observer = new ResizeObserver(entries => {
            const next = entries[0]?.contentRect.width;
            if (next) setWidth(next);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [library === null]);

    // The native GIF picker draws its own header above the panel.
    React.useEffect(() => {
        if (kind !== "gif") return;
        const header = document.getElementById("gif-picker-tab-panel")?.querySelector<HTMLElement>(":scope > [class^='header_']");
        const previous = header?.style.display;
        if (header) header.style.display = "none";
        return () => { if (header) header.style.display = previous ?? ""; };
    }, [kind]);

    React.useEffect(() => {
        if (showDatabase) void cacheStats().then(setCacheInfo);
    }, [showDatabase, caching, library]);

    async function commit(change: (current: LibraryData) => LibraryData) {
        if (busy) return;
        setBusy(true);
        setError("");
        try {
            const saved = await updateLibrary(accountId, change);
            setCategoryDraft(null);
            setRenameDraft(null);
            if (activeCategory && !saved.categories.some(category => category.id === activeCategory)) setActiveCategory(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    const allCategories = (library?.categories ?? []).filter(category => category.kind === kind || category.kind === "all");
    const activeInfo = allCategories.find(category => category.id === activeCategory) ?? null;
    const gifFavorites = kind === "gif" && nativeGifs ? withoutRecentlyRemoved(nativeGifs) : null;
    // GIFs: Discord's favourite list is what is shown, as in FavoriteMedia; the library only adds names and folders.
    const allItems = gifFavorites && library ? gifView(library, gifFavorites) : (library?.items ?? []).filter(item => item.kind === kind);
    const query = normalize(search.trim());
    const scopedCategories = allCategories.filter(category => query
        ? normalize(category.name).includes(query)
        : (category.parentId ?? null) === activeCategory);
    const scopedItems = allItems.filter(item => {
        if (query) return query.split(" ").filter(Boolean).every(word => normalize(`${item.name} ${item.url}`).includes(word));
        if (activeCategory) return item.categoryId === activeCategory;
        return settings.store.hideUnsortedMedias ? item.categoryId == null : true;
    });

    const pageSize = Number(settings.store.maxMediasPerPage) || 50;
    const totalPages = Math.max(1, Math.ceil((scopedCategories.length + scopedItems.length) / pageSize));
    const currentPage = Math.min(page, totalPages);
    const start = (currentPage - 1) * pageSize;
    const pageCategories = scopedCategories.slice(start, start + pageSize);
    const pageItems = scopedItems.slice(Math.max(0, start - scopedCategories.length), Math.max(0, start - scopedCategories.length) + (pageSize - pageCategories.length));

    // Replace expired Discord links stored in the library with fresh ones.
    const staleUrls = [...new Set(pageItems.flatMap(item => [item.url, item.previewUrl]).filter((url): url is string => !!url && needsRefresh(url)))];
    const staleSignature = staleUrls.join("|");
    React.useEffect(() => {
        if (!staleUrls.length) return;
        let alive = true;
        void Promise.all(staleUrls.map(async url => [urlKey(url), await refreshUrl(url)] as const)).then(pairs => {
            const refreshed = Object.fromEntries(pairs.filter(([, fresh]) => !needsRefresh(fresh)));
            if (alive && Object.keys(refreshed).length) void updateLibrary(accountId, current => replaceUrls(current, refreshed)).catch(() => undefined);
        });
        return () => { alive = false; };
    }, [staleSignature]);

    const columns = Math.max(1, Math.floor(Math.max(220, width) / 200));
    const itemWidth = Math.max(120, (Math.max(220, width) - GAP * (columns - 1)) / columns);
    const categoryRows = Math.ceil(pageCategories.length / columns);
    const heights = Array.from({ length: columns }, () => categoryRows * 122);
    const positionedItems = pageItems.map(item => {
        const column = heights.indexOf(Math.min(...heights));
        const ratio = item.width && item.height ? item.height / item.width : 0.72;
        const height = hasVisual(item.kind) ? Math.max(110, Math.min(270, Math.round(itemWidth * ratio))) : 110;
        const style = { left: (itemWidth + GAP) * column, top: heights[column], width: itemWidth, height } as React.CSSProperties;
        heights[column] += height + GAP;
        return { item, style };
    });
    const contentHeight = Math.max(categoryRows * 122, ...heights, 100) + 12;

    const scrollTop = () => scrollRef.current?.scrollTo({ top: 0 });
    const clearSearch = () => { setSearch(""); setPage(1); scrollTop(); };
    const openCategory = (category: MediaCategory) => { setActiveCategory(category.id); setSearch(""); setPage(1); scrollTop(); };
    const goBack = () => {
        if (search) clearSearch();
        else if (activeInfo) { setActiveCategory(activeInfo.parentId ?? null); setPage(1); scrollTop(); }
    };
    const newCategory = (parentId: string | null = activeCategory) => setCategoryDraft({ id: crypto.randomUUID(), name: "", kind, color: "#202225", parentId });

    function thumbnailOf(category: MediaCategory) {
        if (category.thumbnail) return category.thumbnail;
        const first = allItems.find(item => item.categoryId === category.id);
        return first?.kind === "audio" || first?.kind === "file" ? undefined : first?.previewUrl ?? first?.url;
    }

    function descendantsOf(categoryId: string) {
        const result = new Set([categoryId]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const category of allCategories) {
                if (category.parentId && result.has(category.parentId) && !result.has(category.id)) { result.add(category.id); changed = true; }
            }
        }
        return result;
    }

    function categoryMenu(event: React.MouseEvent, category: MediaCategory) {
        event.preventDefault();
        event.stopPropagation();
        const siblings = allCategories.filter(other => (other.parentId ?? null) === (category.parentId ?? null));
        const index = siblings.findIndex(other => other.id === category.id);
        const blocked = descendantsOf(category.id);
        const parents = allCategories.filter(other => !blocked.has(other.id) && (other.kind === "all" || other.kind === category.kind));
        const firstMedia = allItems.find(item => item.categoryId === category.id && hasVisual(item.kind));
        ContextMenuApi.openContextMenu(event, () => <Menu.Menu navId="vc-mediavault-category-menu" onClose={ContextMenuApi.closeContextMenu} aria-label={t("folder.options")}>
            <Menu.MenuItem id="mv-category-open" label={t("folder.open")} action={() => openCategory(category)} />
            <Menu.MenuItem id="mv-category-child" label={t("folder.createChild")} action={() => newCategory(category.id)} />
            <Menu.MenuItem id="mv-category-edit" label={t("folder.edit")} action={() => setCategoryDraft({ ...category })} />
            {index > 0 && <Menu.MenuItem id="mv-category-before" label={t("folder.before")} action={() => void commit(current => moveCategoryOrder(current, category.id, -1, kind))} />}
            {index >= 0 && index < siblings.length - 1 && <Menu.MenuItem id="mv-category-after" label={t("folder.after")} action={() => void commit(current => moveCategoryOrder(current, category.id, 1, kind))} />}
            {parents.length > 0 && <Menu.MenuItem id="mv-category-into" label={t("folder.into")}>
                {parents.map(parent => <Menu.MenuItem key={parent.id} id={`mv-category-into-${parent.id}`} label={parent.name} action={() => void commit(current => moveCategory(current, category.id, parent.id))} />)}
            </Menu.MenuItem>}
            {category.parentId && <Menu.MenuItem id="mv-category-root" label={t("folder.toRoot")} action={() => void commit(current => moveCategory(current, category.id, null))} />}
            {firstMedia && <Menu.MenuItem id="mv-category-thumb" label={t("folder.thumbFirst")} action={() => void commit(current => setCategoryThumbnail(current, category.id, firstMedia.previewUrl ?? firstMedia.url))} />}
            {category.thumbnail && <Menu.MenuItem id="mv-category-unthumb" label={t("folder.unthumb")} action={() => void commit(current => setCategoryThumbnail(current, category.id, undefined))} />}
            <Menu.MenuItem id="mv-category-delete" label={t("folder.delete")} color="danger" action={() => void commit(current => deleteCategory(current, category.id))} />
        </Menu.Menu>);
    }

    function mediaMenu(event: React.MouseEvent, item: SavedMedia) {
        event.preventDefault();
        event.stopPropagation();
        const targets = allCategories.filter(category => category.id !== item.categoryId);
        const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => notify(t("toast.copied"))); };
        ContextMenuApi.openContextMenu(event, () => <Menu.Menu navId="vc-mediavault-media-menu" onClose={ContextMenuApi.closeContextMenu} aria-label={t("media.options")}>
            <Menu.MenuItem id="mv-media-send" label={t("media.send")} action={() => void chooseMedia(item, onSelect, false)} />
            <Menu.MenuItem id="mv-media-rename" label={t("media.rename")} action={() => setRenameDraft({ url: item.url, name: item.name })} />
            <Menu.MenuItem id="mv-media-copy" label={t("media.copyLink")} action={() => void refreshUrl(item.url).then(copy)} />
            {item.messageUrl && <Menu.MenuItem id="mv-media-copy-message" label={t("media.copyMessage")} action={() => copy(item.messageUrl as string)} />}
            {item.sourceUrl && <Menu.MenuItem id="mv-media-copy-source" label={t("media.copySource")} action={() => copy(item.sourceUrl as string)} />}
            <Menu.MenuItem id="mv-media-download" label={t("media.download")} action={() => void downloadMedia(item)} />
            {hasLocalCopy(localKeys, item) && <Menu.MenuItem id="mv-media-local" label={t("media.local")}>
                <Menu.MenuItem id="mv-media-local-send" label={t("media.localSend")} action={() => void chooseMedia(item, onSelect, false, true)} />
                <Menu.MenuItem id="mv-media-local-save" label={t("media.localSave")} action={() => void saveLocalCopy(item).then(ok => { if (!ok) notify(t("media.noLocal"), true); })} />
            </Menu.MenuItem>}
            {(targets.length > 0 || item.categoryId) && <Menu.MenuItem id="mv-media-move" label={item.categoryId ? t("media.moveTo") : t("media.addToFolder")}>
                {item.categoryId && <Menu.MenuItem id="mv-media-unsorted" label={t("media.unsorted")} disabled={busy} action={() => void commit(current => moveMedia(ensureMedia(current, item), item.url, null))} />}
                {targets.map(category => <Menu.MenuItem key={category.id} id={`mv-media-to-${category.id}`} label={category.name} disabled={busy} action={() => void commit(current => moveMedia(ensureMedia(current, item), item.url, category.id))} />)}
            </Menu.MenuItem>}
            {item.categoryId && hasVisual(item.kind) && <Menu.MenuItem id="mv-media-thumb" label={t("media.thumbFolder")} action={() => void commit(current => setCategoryThumbnail(current, item.categoryId as string, item.previewUrl ?? item.url))} />}
            <Menu.MenuItem id="mv-media-remove" label={t("media.remove")} color="danger" action={() => void removeSaved(accountId, item).catch(e => setError(e instanceof Error ? e.message : String(e)))} />
        </Menu.Menu>);
    }

    function gridMenu(event: React.MouseEvent) {
        if ((event.target as HTMLElement).closest(".mv-result,button,input,label")) return;
        event.preventDefault();
        ContextMenuApi.openContextMenu(event, () => <Menu.Menu navId="vc-mediavault-grid-menu" onClose={ContextMenuApi.closeContextMenu} aria-label={t("grid.title")}>
            <Menu.MenuItem id="mv-create" label={activeInfo ? t("folder.createChild") : t("grid.createFolder")} action={() => newCategory()} />
            <Menu.MenuItem id="mv-export" label={t("grid.export")} action={() => library && exportLibrary(library)} />
            <Menu.MenuItem id="mv-import" label={t("grid.import")} action={() => fileInputRef.current?.click()} />
        </Menu.Menu>);
    }

    function folderDrop(category: MediaCategory) {
        const accepts = (event: React.DragEvent) => {
            if (!isVaultDrag(event)) return false;
            event.preventDefault();
            event.stopPropagation();
            return true;
        };
        return {
            onDragEnter(event: React.DragEvent) { if (accepts(event)) (event.currentTarget as HTMLElement).dataset.dragOver = "true"; },
            onDragOver(event: React.DragEvent) { if (accepts(event)) { event.dataTransfer.dropEffect = "move"; (event.currentTarget as HTMLElement).dataset.dragOver = "true"; } },
            onDragLeave(event: React.DragEvent) {
                if (isVaultDrag(event) && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) delete (event.currentTarget as HTMLElement).dataset.dragOver;
            },
            onDrop(event: React.DragEvent) {
                if (!accepts(event)) return;
                delete (event.currentTarget as HTMLElement).dataset.dragOver;
                const media = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
                const dragged = event.dataTransfer.getData(CATEGORY_DRAG_TYPE);
                const draggedMedia = allItems.find(entry => entry.url === media);
                if (media) void commit(current => moveMedia(draggedMedia ? ensureMedia(current, draggedMedia) : current, media, category.id));
                else if (dragged && dragged !== category.id) void commit(current => moveCategory(current, dragged, category.id));
            }
        };
    }

    async function importFile(file: File) {
        try {
            const parsed = JSON.parse(await file.text());
            const incoming = readImportedLibrary(parsed);
            let summary = "";
            await updateLibrary(accountId, current => {
                const result = mergeLibraries(current, incoming, () => `import-${crypto.randomUUID()}`);
                summary = t("toast.imported", { items: result.addedItems, folders: result.addedCategories });
                return result.library;
            });
            notify(summary);
        } catch (e) {
            setError(t("toast.importFailed", { error: e instanceof Error ? e.message : String(e) }));
        }
    }

    const unavailableItems = allItems.filter(item => isUnavailable(item.previewUrl ?? item.url) && !hasLocalCopy(localKeys, item));

    async function removeUnavailable() {
        const targets = [...unavailableItems];
        for (const item of targets) await removeSaved(accountId, item).catch(() => undefined);
        notify(t("toast.removedDead", { count: targets.length }));
    }

    async function exportToFolder() {
        if (!library) return;
        setCaching(true);
        let done = 0;
        for (const item of library.items) {
            const blob = await getArchive(item).catch(() => undefined);
            if (blob && await writeToDisk(item, blob).catch(() => false)) done++;
        }
        setCaching(false);
        notify(t("toast.exported", { count: done }));
    }

    async function openFolder() {
        const failure = await openDiskFolder();
        if (failure) notify(failure, true);
    }

    async function cacheEverything() {
        if (!library) return;
        setCaching(true);
        let done = 0;
        for (const item of library.items) {
            const url = item.kind === "video" ? item.previewUrl : hasVisual(item.kind) ? item.previewUrl ?? item.url : undefined;
            if (!url) continue;
            if (await cacheMedia(url).then(() => true, () => false)) done++;
            await archiveMedia(item).catch(() => undefined);
        }
        setCaching(false);
        notify(t("toast.cached", { count: done }));
    }

    if (library === null) return <div className="mv-empty">{t("loading")}{loadError && <p role="alert">{loadError}</p>}</div>;

    const iconButton = (label: string, icon: Parameters<typeof Icon>[0]["name"], onClick: () => void, selected = false) =>
        <button type="button" className={`mv-icon-button ${selected ? "selected" : ""}`} title={label} aria-label={label} onClick={onClick}><Icon name={icon} /></button>;

    return <section className={`mv-picker mv-picker-${kind}`} id={`mv-${kind}-picker-tab-panel`} role="tabpanel" aria-label={t(`button.${kind === "gif" ? "image" : kind}` as Key)}>
        <div className="mv-header">
            <div className="mv-header-right">
                <span className="mv-count" title={t("count")}>{scopedItems.length}</span>
                {iconButton(t("db.title"), "database", () => setShowDatabase(value => !value), showDatabase)}
                {iconButton(t("import.title"), "import", () => fileInputRef.current?.click())}
                {iconButton(t("options"), "settings", () => setShowSettings(value => !value), showSettings)}
            </div>
            <div className="mv-header-searchrow">
                {(activeInfo || search) && <button type="button" className="mv-back-button" aria-label={t("back")} title={t("back")} onClick={goBack}><Icon name="back" /></button>}
                {activeInfo && !search
                    ? <h2 className="mv-category-heading">{activeInfo.name}</h2>
                    : <div className="mv-search">
                        <Icon name="search" />
                        <input value={search} placeholder={t(`search.${kind}` as Key)} aria-label={t("search.label")} onChange={event => { setSearch(event.target.value); setPage(1); scrollTop(); }} />
                        {search && <button type="button" className="mv-search-clear" title={t("search.clear")} onClick={clearSearch}>×</button>}
                    </div>}
            </div>
        </div>

        {showDatabase && <div className="mv-database-panel">
            <div className="mv-database-stats">
                <div><span>{t("db.media")}</span><strong>{library.items.length}</strong></div>
                <div><span>{t("db.folders")}</span><strong>{library.categories.length}</strong></div>
                <div><span>{t("db.files")}</span><strong>{cacheInfo ? t("db.size", { count: cacheInfo.count, size: (cacheInfo.bytes / 1048576).toFixed(1) }) : "…"}</strong></div>
                <div><span>{t("db.covered")}</span><strong>{library.items.filter(item => hasLocalCopy(localKeys, item)).length} / {library.items.length}</strong></div>
            </div>
            <div className="mv-database-actions">
                <button type="button" onClick={() => exportLibrary(library)}>{t("db.exportJson")}</button>
                <button type="button" onClick={() => fileInputRef.current?.click()}>{t("db.importBackup")}</button>
                <button type="button" disabled={caching} onClick={() => void cacheEverything()}>{caching ? t("db.copying") : t("db.copyAll")}</button>
                {canUseDisk && <button type="button" onClick={() => void openFolder()}>{t("db.openFolder")}</button>}
                {canUseDisk && <button type="button" disabled={caching} onClick={() => void exportToFolder()}>{t("db.exportAll")}</button>}
                {unavailableItems.length > 0 && <button type="button" onClick={() => void removeUnavailable()}>{t("db.removeDead", { count: unavailableItems.length })}</button>}
                <button type="button" disabled={caching} onClick={() => void pruneCache(library).then(count => { notify(count ? t("toast.pruned", { count }) : t("toast.prunedNone")); return cacheStats().then(setCacheInfo); })}>{t("db.prune")}</button>
                <button type="button" disabled={caching || !cacheInfo?.count} onClick={() => void clearCache().then(() => cacheStats().then(setCacheInfo))}>{t("db.clear")}</button>
            </div>
            {canUseDisk && <p className="mv-database-note">{t("db.folderPath", { path: folder ?? "…" })}</p>}
            <p className="mv-database-note">{t("db.note")}</p>
            <p>{t("db.storage")}</p>
        </div>}

        {showSettings && <div className="mv-quick-settings">
            <label><input type="checkbox" checked={settings.store.hideUnsortedMedias} onChange={event => { settings.store.hideUnsortedMedias = event.target.checked; refreshSettings(value => value + 1); }} /> {t("opt.hideUnsorted")}</label>
            <label><input type="checkbox" checked={settings.store.hideThumbnail} onChange={event => { settings.store.hideThumbnail = event.target.checked; refreshSettings(value => value + 1); }} /> {t("opt.hideThumb")}</label>
            <label><input type="checkbox" checked={settings.store.alwaysSendInstantly} onChange={event => { settings.store.alwaysSendInstantly = event.target.checked; refreshSettings(value => value + 1); }} /> {t("opt.instant")}</label>
            <span>{t("opt.more")}</span>
        </div>}

        {categoryDraft && <form className="mv-category-editor" onSubmit={event => { event.preventDefault(); void commit(current => upsertCategory(current, categoryDraft)); }}>
            <label className="mv-editor-name">{t("folder.name")}<input autoFocus value={categoryDraft.name} maxLength={20} required placeholder={t("folder.placeholder")} onChange={event => setCategoryDraft({ ...categoryDraft, name: event.target.value })} /></label>
            <label className="mv-editor-color">{t("folder.color")}<input type="color" value={categoryDraft.color ?? "#202225"} onChange={event => setCategoryDraft({ ...categoryDraft, color: event.target.value })} /></label>
            <button type="submit" disabled={busy}>{t("save")}</button>
            <button type="button" disabled={busy} onClick={() => setCategoryDraft(null)}>{t("cancel")}</button>
        </form>}

        {renameDraft && <form className="mv-category-editor" onSubmit={event => { event.preventDefault(); void commit(current => { const shown = allItems.find(entry => entry.url === renameDraft.url); return renameMedia(shown ? ensureMedia(current, shown) : current, renameDraft.url, renameDraft.name); }); }}>
            <label className="mv-editor-name">{t("media.name")}<input autoFocus value={renameDraft.name} maxLength={80} required onChange={event => setRenameDraft({ ...renameDraft, name: event.target.value })} /></label>
            <button type="submit" disabled={busy}>{t("save")}</button>
            <button type="button" disabled={busy} onClick={() => setRenameDraft(null)}>{t("cancel")}</button>
        </form>}

        {(error || loadError) && <div className="mv-error" role="alert">{error || loadError}</div>}

        <div className={`mv-scroll ${ScrollerClasses.thin ?? ""}`} ref={scrollRef} onContextMenu={gridMenu}>
            <div ref={canvasRef} className="mv-canvas" style={{ height: contentHeight }}>
                {pageCategories.map((category, index) => <CategoryFolder key={category.id} category={category} thumbnail={thumbnailOf(category)}
                    style={{ left: (itemWidth + GAP) * (index % columns), top: 122 * Math.floor(index / columns), width: itemWidth, height: 110 } as React.CSSProperties}
                    onOpen={() => openCategory(category)} onContextMenu={event => categoryMenu(event, category)}
                    onDragStart={event => { event.dataTransfer.setData(CATEGORY_DRAG_TYPE, category.id); event.dataTransfer.effectAllowed = "move"; }}
                    dragProps={folderDrop(category)} />)}
                {positionedItems.map(({ item, style }) => <MediaCard key={`${item.url}:${item.savedAt}`} item={item} hasCopy={hasLocalCopy(localKeys, item)} style={style}
                    onRemove={() => removeSaved(accountId, item)}
                    onSelect={event => void chooseMedia(item, onSelect, event.shiftKey)} onContextMenu={event => mediaMenu(event, item)}
                    onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData(MEDIA_DRAG_TYPE, item.url); event.dataTransfer.effectAllowed = "move"; }} />)}
            </div>
            {pageCategories.length + pageItems.length === 0 && <div className="mv-empty mv-empty-hint">
                {search ? t("empty.search")
                    : activeInfo ? t("empty.folder")
                        : t("empty.root")}
            </div>}
            {scopedCategories.length + scopedItems.length > 0 && <div className="mv-grid-context-hint">{t("hint")}</div>}
            {totalPages > 1 && <div className="mv-page-control">
                <button type="button" disabled={currentPage <= 1} aria-label={t("page.prev")} onClick={() => { setPage(currentPage - 1); scrollTop(); }}><Icon name="left" /></button>
                <span>{currentPage} / {totalPages}</span>
                <button type="button" disabled={currentPage >= totalPages} aria-label={t("page.next")} onClick={() => { setPage(currentPage + 1); scrollTop(); }}><Icon name="right" /></button>
            </div>}
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importFile(file);
        }} />
    </section>;
}

