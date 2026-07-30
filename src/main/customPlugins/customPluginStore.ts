/**
 * customPluginStore.ts
 *
 * Persists custom plugin source (fetched from other Vencord/Equicord forks)
 * in IndexedDB so it survives reloads and can be re-registered on every boot.
 *
 * Drop this alongside your existing Vencord/Equicord internals, e.g.
 * src/main/customPlugins/customPluginStore.ts
 */

export interface StoredCustomPlugin {
    /** Plugin name as declared in its definePlugin() call — used as the DB key */
    name: string;
    /** Raw source text, exactly as downloaded (TS/TSX or already-compiled JS) */
    source: string;
    /** Where it came from, if fetched by URL — purely informational */
    sourceUrl?: string;
    /** Unix ms timestamp */
    addedAt: number;
    /** Whether the user has enabled it — disabled plugins are stored but skipped at boot */
    enabled: boolean;
}

const DB_NAME = "VeilCustomPlugins";
const STORE_NAME = "plugins";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "name" });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getAllCustomPlugins(): Promise<StoredCustomPlugin[]> {
    return withStore("readonly", store => store.getAll());
}

export async function getCustomPlugin(name: string): Promise<StoredCustomPlugin | undefined> {
    return withStore("readonly", store => store.get(name));
}

export async function saveCustomPlugin(plugin: StoredCustomPlugin): Promise<void> {
    await withStore("readwrite", store => store.put(plugin));
}

export async function deleteCustomPlugin(name: string): Promise<void> {
    await withStore("readwrite", store => store.delete(name));
}

export async function setCustomPluginEnabled(name: string, enabled: boolean): Promise<void> {
    const existing = await getCustomPlugin(name);
    if (!existing) return;
    await saveCustomPlugin({ ...existing, enabled });
}
