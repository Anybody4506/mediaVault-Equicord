/*
 * MediaVault, a media library for Vencord / Equicord
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { useCallback, useEffect, useState } from "@webpack/common";

import { LibraryData, readLibrary } from "./model";

const STORAGE_PREFIX = "MediaVault:v1:";
const MEDIA_CHANGED_EVENT = "vc-mediavault-changed";
const writeQueues = new Map<string, Promise<unknown>>();

export const storageKey = (accountId: string) => `${STORAGE_PREFIX}${accountId}`;

const shared = new Map<string, Promise<LibraryData>>();

/** One read per account is shared by every star button and panel until the next write. */
export function loadLibrary(accountId: string): Promise<LibraryData> {
    let pending = shared.get(accountId);
    if (!pending) {
        pending = DataStore.get(storageKey(accountId)).then(readLibrary);
        shared.set(accountId, pending);
        pending.catch(() => shared.delete(accountId));
    }
    return pending;
}

/** Serialises writes per account so two quick clicks never overwrite each other. */
export async function updateLibrary(accountId: string, change: (current: LibraryData) => LibraryData): Promise<LibraryData> {
    const key = storageKey(accountId);
    const previous = writeQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
        let updated: LibraryData | undefined;
        await DataStore.update(key, value => {
            updated = change(readLibrary(value));
            return updated;
        });
        if (!updated) throw new Error("MediaVault could not confirm that the data was saved.");
        return updated;
    });
    writeQueues.set(key, next.then(() => undefined, () => undefined));
    const result = await next;
    shared.delete(accountId);
    window.dispatchEvent(new CustomEvent(MEDIA_CHANGED_EVENT, { detail: { accountId } }));
    return result;
}

export function useLibrary(accountId: string | undefined) {
    const [library, setLibrary] = useState<LibraryData | null>(null);
    const [error, setError] = useState("");

    const reload = useCallback(() => {
        if (!accountId) return Promise.resolve();
        return loadLibrary(accountId).then(value => { setLibrary(value); setError(""); }, e => setError(e instanceof Error ? e.message : String(e)));
    }, [accountId]);

    useEffect(() => {
        setLibrary(null);
        void reload();
        const onChange = (event: Event) => {
            const detail = (event as CustomEvent<{ accountId?: string; }>).detail;
            if (!detail?.accountId || detail.accountId === accountId) void reload();
        };
        window.addEventListener(MEDIA_CHANGED_EVENT, onChange);
        return () => window.removeEventListener(MEDIA_CHANGED_EVENT, onChange);
    }, [accountId, reload]);

    return { library, error, reload };
}
