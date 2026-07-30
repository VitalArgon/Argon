/**
 * CustomPluginsTab.tsx
 *
 * Settings tab: paste source, fetch from a URL, or upload a file to add a
 * plugin from another Vencord/Equicord fork. Lists installed custom plugins
 * with enable/disable and remove controls.
 *
 * Lives in src/main/customPlugins/ alongside customPluginStore.ts and
 * customPluginLoader.ts — imports below assume that location.
 *
 * Registration only takes effect on next reload (see loader.ts's timing
 * note) — this tab makes that explicit rather than pretending it's live.
 */

import { Margins } from "@utils/margins";
import { Button, Forms, React, Switch, TextArea, TextInput, useEffect, useState } from "@webpack/common";

import {
    deleteCustomPlugin,
    getAllCustomPlugins,
    saveCustomPlugin,
    setCustomPluginEnabled,
    type StoredCustomPlugin,
} from "./customPluginStore";
import { dryRunCompile } from "./customPluginLoader";

const cl = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(" ");

export function CustomPluginsTab() {
    const [plugins, setPlugins] = useState<StoredCustomPlugin[]>([]);
    const [pasteValue, setPasteValue] = useState("");
    const [urlValue, setUrlValue] = useState("");
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<{ kind: "idle" | "error" | "success"; message?: string; }>({ kind: "idle" });
    const [needsReload, setNeedsReload] = useState(false);

    const refresh = () => getAllCustomPlugins().then(setPlugins);

    useEffect(() => {
        refresh();
    }, []);

    async function addSource(source: string, sourceUrl?: string) {
        if (!source.trim()) return;
        setBusy(true);
        setStatus({ kind: "idle" });
        try {
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
        } finally {
            setBusy(false);
        }
    }

    async function addFromUrl() {
        if (!urlValue.trim()) return;
        setBusy(true);
        try {
            const res = await fetch(urlValue.trim());
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const source = await res.text();
            await addSource(source, urlValue.trim());
        } catch (err) {
            setStatus({ kind: "error", message: `Fetch failed: ${err}` });
        } finally {
            setBusy(false);
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
        <React.Fragment>
            <Forms.FormTitle tag="h2">Custom Plugins</Forms.FormTitle>
            <Forms.FormText className={Margins.bottom20} style={{ opacity: 0.7 }}>
                Load plugins written for other Vencord/Equicord forks. Patches only take effect after a reload.
            </Forms.FormText>

            <Forms.FormSection>
                <Forms.FormTitle tag="h5">Add from URL</Forms.FormTitle>
                <div style={{ display: "flex", gap: 8 }}>
                    <TextInput
                        value={urlValue}
                        onChange={setUrlValue}
                        placeholder="https://raw.githubusercontent.com/.../myPlugin.tsx"
                        style={{ flex: 1 }}
                    />
                    <Button
                        size={Button.Sizes.SMALL}
                        disabled={busy || !urlValue.trim()}
                        onClick={addFromUrl}
                    >
                        Fetch &amp; add
                    </Button>
                </div>

                <Forms.FormTitle tag="h5" className={Margins.top20}>Add from file</Forms.FormTitle>
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    look={Button.Looks.OUTLINED}
                    onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = ".ts,.tsx,.js,.jsx";
                        input.onchange = () => {
                            const file = input.files?.[0];
                            if (file) addFromFile(file);
                        };
                        input.click();
                    }}
                >
                    Choose file…
                </Button>

                <Forms.FormTitle tag="h5" className={Margins.top20}>Or paste source</Forms.FormTitle>
                <TextArea
                    value={pasteValue}
                    onChange={setPasteValue}
                    placeholder="Paste a plugin's definePlugin(...) source here"
                    rows={8}
                />
                <Button
                    className={Margins.top8}
                    size={Button.Sizes.SMALL}
                    disabled={busy || !pasteValue.trim()}
                    onClick={() => addSource(pasteValue)}
                >
                    Add pasted source
                </Button>

                {status.kind !== "idle" && (
                    <Forms.FormText
                        className={Margins.top8}
                        style={{ color: status.kind === "error" ? "var(--text-danger)" : "var(--text-positive)" }}
                    >
                        {status.message}
                    </Forms.FormText>
                )}

                {needsReload && (
                    <div
                        className={cl(Margins.top16, "veil-custom-plugins-reload-card")}
                        style={{
                            padding: 12,
                            borderRadius: 8,
                            background: "var(--background-secondary)",
                            border: "1px solid var(--background-modifier-accent)",
                        }}
                    >
                        <Forms.FormText>Changes need a reload to take effect.</Forms.FormText>
                        <Button
                            className={Margins.top8}
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.RED}
                            onClick={() => window.location.reload()}
                        >
                            Reload now
                        </Button>
                    </div>
                )}
            </Forms.FormSection>

            <Forms.FormDivider className={Margins.top20 + " " + Margins.bottom20} />

            <Forms.FormTitle tag="h5">Installed custom plugins</Forms.FormTitle>
            {plugins.length === 0 && (
                <Forms.FormText style={{ opacity: 0.7 }}>None yet.</Forms.FormText>
            )}
            {plugins.map(p => (
                <div
                    key={p.name}
                    className={cl(Margins.bottom8, "veil-custom-plugin-card")}
                    style={{
                        padding: 12,
                        borderRadius: 8,
                        background: "var(--background-secondary)",
                        border: "1px solid var(--background-modifier-accent)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <div>
                        <Forms.FormTitle tag="h5" style={{ marginBottom: 0 }}>{p.name}</Forms.FormTitle>
                        {p.sourceUrl && (
                            <Forms.FormText style={{ opacity: 0.7 }}>{p.sourceUrl}</Forms.FormText>
                        )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Switch
                            value={p.enabled}
                            onChange={(v: boolean) => toggle(p.name, v)}
                        />
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.RED}
                            look={Button.Looks.OUTLINED}
                            onClick={() => remove(p.name)}
                        >
                            Remove
                        </Button>
                    </div>
                </div>
            ))}
        </React.Fragment>
    );
}
