/**
 * CustomPluginsTab.tsx
 *
 * Settings tab: paste source, fetch from a URL, or upload a file to add a
 * plugin from another Vencord/Equicord fork. Lists installed custom plugins
 * with enable/disable and remove controls.
 *
 * Written with plain elements so it has no dependency on your fork's UI kit.
 * Swap `<button>`/`<input>` for Vencord's own <Button>, <Forms.FormText>,
 * <TextInput> etc. if you want it to match the native settings look — the
 * logic below doesn't care either way.
 *
 * Registration only takes effect on next reload (see loader.ts's timing
 * note) — this tab makes that explicit rather than pretending it's live.
 */

import { useEffect, useState } from "react";
import {
    deleteCustomPlugin,
    getAllCustomPlugins,
    saveCustomPlugin,
    setCustomPluginEnabled,
    type StoredCustomPlugin,
} from "./customPluginStore";
import { dryRunCompile } from "./customPluginLoader";

export function CustomPluginsTab() {
    const [plugins, setPlugins] = useState<StoredCustomPlugin[]>([]);
    const [pasteValue, setPasteValue] = useState("");
    const [urlValue, setUrlValue] = useState("");
    const [status, setStatus] = useState<{ kind: "idle" | "error" | "success"; message?: string }>({ kind: "idle" });
    const [needsReload, setNeedsReload] = useState(false);

    const refresh = () => getAllCustomPlugins().then(setPlugins);

    useEffect(() => {
        refresh();
    }, []);

    async function addSource(source: string, sourceUrl?: string) {
        setStatus({ kind: "idle" });
        const check = await dryRunCompile(source);
        if (!check.ok) {
            setStatus({ kind: "error", message: check.error });
            return;
        }
        await saveCustomPlugin({
            name: check.name!,
            source,
            sourceUrl,
            addedAt: Date.now(),
            enabled: true,
        });
        setStatus({ kind: "success", message: `Added "${check.name}" — reload to apply.` });
        setNeedsReload(true);
        setPasteValue("");
        setUrlValue("");
        refresh();
    }

    async function addFromUrl() {
        if (!urlValue.trim()) return;
        try {
            const res = await fetch(urlValue.trim());
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const source = await res.text();
            await addSource(source, urlValue.trim());
        } catch (err) {
            setStatus({ kind: "error", message: `Fetch failed: ${err}` });
        }
    }

    async function addFromFile(file: File) {
        const source = await file.text();
        await addSource(source);
    }

    async function remove(name: string) {
        await deleteCustomPlugin(name);
        setNeedsReload(true);
        refresh();
    }

    async function toggle(name: string, enabled: boolean) {
        await setCustomPluginEnabled(name, enabled);
        setNeedsReload(true);
        refresh();
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
                <h3>Add a plugin</h3>
                <p style={{ opacity: 0.7, fontSize: 13 }}>
                    Works with plugins written for other Vencord/Equicord forks.
                    Patches only take effect after a reload.
                </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                <input
                    type="text"
                    placeholder="https://raw.githubusercontent.com/.../myPlugin.tsx"
                    value={urlValue}
                    onChange={e => setUrlValue(e.target.value)}
                    style={{ flex: 1 }}
                />
                <button onClick={addFromUrl}>Fetch & add</button>
                <label style={{ cursor: "pointer" }}>
                    <input
                        type="file"
                        accept=".ts,.tsx,.js,.jsx"
                        style={{ display: "none" }}
                        onChange={e => {
                            const file = e.target.files?.[0];
                            if (file) addFromFile(file);
                        }}
                    />
                    <span style={{ padding: "6px 12px", border: "1px solid currentColor", borderRadius: 4 }}>
                        Upload file
                    </span>
                </label>
            </div>

            <textarea
                placeholder="...or paste plugin source directly"
                value={pasteValue}
                onChange={e => setPasteValue(e.target.value)}
                rows={8}
                style={{ fontFamily: "monospace", fontSize: 12 }}
            />
            <button onClick={() => addSource(pasteValue)} disabled={!pasteValue.trim()}>
                Add pasted source
            </button>

            {status.kind !== "idle" && (
                <div style={{ color: status.kind === "error" ? "var(--text-danger, #f04747)" : "var(--text-positive, #43b581)" }}>
                    {status.message}
                </div>
            )}

            {needsReload && (
                <div style={{ padding: 8, border: "1px solid currentColor", borderRadius: 4 }}>
                    Changes need a reload to take effect.{" "}
                    <button onClick={() => window.location.reload()}>Reload now</button>
                </div>
            )}

            <hr />

            <h3>Installed custom plugins</h3>
            {plugins.length === 0 && <p style={{ opacity: 0.7 }}>None yet.</p>}
            {plugins.map(p => (
                <div
                    key={p.name}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: 8,
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 4,
                    }}
                >
                    <div>
                        <strong>{p.name}</strong>
                        {p.sourceUrl && (
                            <div style={{ fontSize: 11, opacity: 0.6 }}>{p.sourceUrl}</div>
                        )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <label>
                            <input
                                type="checkbox"
                                checked={p.enabled}
                                onChange={e => toggle(p.name, e.target.checked)}
                            />{" "}
                            Enabled
                        </label>
                        <button onClick={() => remove(p.name)}>Remove</button>
                    </div>
                </div>
            ))}
        </div>
    );
}
