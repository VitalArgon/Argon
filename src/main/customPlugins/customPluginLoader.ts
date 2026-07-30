/**
 * customPluginLoader.ts
 *
 * Loads plugin source that was written for ANOTHER Vencord/Equicord fork and
 * registers it into Veil's own plugin registry, early enough that string
 * `patches` still get applied to Discord's webpack modules.
 *
 * ── WHY TIMING MATTERS (confirmed against Equicord's actual source) ──────
 * In src/Vencord.ts, patch registration happens via a synchronous,
 * run-ONCE call: `initPluginManager()`, called immediately after
 * `import "~plugins"` — before initStyles(), before startAllPlugins(),
 * before anything async. That function (src/api/PluginManager.ts) loops
 * over every plugin in the `Plugins` map and, for each one that's both
 * present AND enabled in Settings.plugins, calls `addPatch()` per patch.
 * It's wrapped in `onlyOnce()`, so it never runs again.
 *
 * That means a custom plugin's patches only get registered if it's already
 * sitting in the `Plugins` map — WITH a corresponding enabled entry in
 * Settings.plugins — by the moment `initPluginManager()` executes. Since
 * that call is synchronous and IndexedDB reads are not, your fork's
 * Vencord.ts needs to be changed to await the custom-plugin load first:
 *
 *   (async () => {
 *       await initCustomPlugins();   // populates Plugins.plugins + Settings.plugins
 *       initPluginManager();
 *       initStyles();
 *       startAllPlugins(StartAt.Init);
 *       init();
 *   })();
 *
 * in place of the current unwrapped
 *   initPluginManager();
 *   initStyles();
 *   startAllPlugins(StartAt.Init);
 *   init();
 * sequence at the bottom of Vencord.ts. This only delays your OWN script's
 * boot by however long the IndexedDB read takes (typically low
 * milliseconds) — it doesn't wait on Discord or on network. Whether that
 * delay is safe depends on how Veil gets injected relative to Discord's own
 * bundle (extension content-script timing, page-injection proxy, etc.) —
 * worth confirming empirically in your actual build rather than assuming.
 *
 * ── THE IMPORT PROBLEM ──────────────────────────────────────────────────
 * Plugins from other forks are written against that fork's internal import
 * aliases: `@webpack`, `@webpack/common`, `@api/Settings`, `@utils/types`,
 * `@components/...`, etc. Those aliases only exist at THAT fork's build
 * time — there's no bundler here to resolve them at runtime. Instead we:
 *   1. Strip TS/JSX with sucrase (fast, no type-checking, browser-safe).
 *   2. Rewrite `import ... from "spec"` / `export ...` into a tiny
 *      CommonJS-like shim so we can execute the result directly.
 *   3. Resolve each import specifier against ALIAS_MAP, which maps fork
 *      import paths to whatever your own fork exposes at runtime
 *      (window.Vencord / window.Equicord / window.Veil — adjust to match).
 *
 * You WILL need to extend ALIAS_MAP as you hit plugins that import things
 * your runtime doesn't expose yet under those names. Equicord/Vencord
 * already expose most of the useful surface on the global object for their
 * own devtools/reporter, so this is mostly a matter of matching names up.
 */

import { getAllCustomPlugins, type StoredCustomPlugin } from "./customPluginStore";
import { registerCustomPluginsSettingsEntry } from "./registerSettingsEntry";

// ─────────────────────────────────────────────────────────────────────────
// 1. Alias map: import specifier -> resolver returning the runtime export
// ─────────────────────────────────────────────────────────────────────────

/**
 * Adjust this to match what YOUR fork exposes on window at boot time.
 * Vencord/Equicord conventionally expose `window.Vencord` with sub-objects
 * like Webpack, Api, Util, Components, Plugins. If Veil renamed the global,
 * change `RUNTIME_GLOBAL` below and nothing else needs to change.
 */
const RUNTIME_GLOBAL = "Vencord"; // e.g. "Veil" if you renamed the exposed global

function runtime(): any {
    const g = (window as any)[RUNTIME_GLOBAL];
    if (!g) {
        throw new Error(
            `[CustomPlugins] window.${RUNTIME_GLOBAL} isn't available yet — ` +
            `initCustomPlugins() is being called too early or too late relative to your fork's own init.`
        );
    }
    return g;
}

/**
 * Each entry maps an import specifier a plugin might use to a function that
 * returns the corresponding runtime object. Extend freely — this is the
 * part you'll iterate on most as you test real plugins.
 */
const ALIAS_MAP: Record<string, () => any> = {
    "@webpack": () => runtime().Webpack,
    "@webpack/common": () => runtime().Webpack.Common,
    "@webpack/types": () => ({}), // type-only import, safe to no-op
    "@api/Settings": () => runtime().Api?.Settings ?? runtime().Settings,
    "@api/ContextMenu": () => runtime().Api?.ContextMenu,
    "@api/MessageEvents": () => runtime().Api?.MessageEvents,
    "@api/DataStore": () => runtime().Api?.DataStore ?? runtime().Util?.DataStore,
    "@utils/types": () => ({ definePlugin: runtime().Util?.definePlugin ?? runtime().definePlugin }),
    "@utils/misc": () => runtime().Util,
    "@utils/react": () => runtime().Util,
    "@components/Icons": () => runtime().Components?.Icons ?? {},
    "@components/ErrorBoundary": () => runtime().Components?.ErrorBoundary,
    "react": () => (window as any).React,
    "react-dom": () => (window as any).ReactDOM,
};

function resolveImport(specifier: string): any {
    const resolver = ALIAS_MAP[specifier];
    if (resolver) return resolver();

    // Fallback: some forks use relative-ish or slightly different aliasing
    // (e.g. "@webpack/common/react"). Try a prefix match before giving up.
    const prefixMatch = Object.keys(ALIAS_MAP).find(k => specifier.startsWith(k + "/"));
    if (prefixMatch) return resolveImport(prefixMatch);

    throw new Error(
        `[CustomPlugins] No runtime mapping for import "${specifier}". ` +
        `Add it to ALIAS_MAP in customPluginLoader.ts.`
    );
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Transform: TS/TSX source -> executable JS with imports resolved
// ─────────────────────────────────────────────────────────────────────────

let sucrasePromise: Promise<any> | null = null;
function loadSucrase() {
    // Loaded lazily via dynamic import so it doesn't bloat your main bundle.
    // `sucrase` needs to be a dependency, or swap this for esbuild-wasm if
    // you'd rather have a real bundler-grade transform.
    sucrasePromise ??= import("sucrase");
    return sucrasePromise;
}

/** Turns `import { a, b as c } from "spec";` into `const { a, b: c } = __require("spec");` */
function rewriteImports(code: string): string {
    return code.replace(
        /import\s*{([^}]+)}\s*from\s*["']([^"']+)["'];?/g,
        (_match, names: string, spec: string) => {
            const destructure = names
                .split(",")
                .map(n => n.trim())
                .filter(Boolean)
                .map(n => {
                    const [orig, alias] = n.split(/\s+as\s+/).map(s => s.trim());
                    return alias ? `${orig}: ${alias}` : orig;
                })
                .join(", ");
            return `const { ${destructure} } = __require(${JSON.stringify(spec)});`;
        }
    ).replace(
        /import\s+(\w+)\s+from\s*["']([^"']+)["'];?/g,
        (_match, defaultName: string, spec: string) =>
            `const ${defaultName} = __require(${JSON.stringify(spec)}).default ?? __require(${JSON.stringify(spec)});`
    ).replace(
        /export\s+default\s+/,
        "module.exports.default = "
    );
}

async function compilePluginSource(source: string): Promise<any> {
    const { transform } = await loadSucrase();
    const { code: stripped } = transform(source, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "classic",
    });

    const rewritten = rewriteImports(stripped);

    // Execute in a scoped function with our own require/module/exports.
    // eslint-disable-next-line no-new-func
    const factory = new Function(
        "__require",
        "module",
        "exports",
        "React",
        `${rewritten}\nreturn module.exports;`
    );

    const module = { exports: {} as any };
    return factory(resolveImport, module, module.exports, (window as any).React);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Registration: hand the compiled plugin object to the real plugin system
// ─────────────────────────────────────────────────────────────────────────

function validatePluginShape(plugin: any, name: string) {
    if (!plugin || typeof plugin !== "object") {
        throw new Error(`Plugin "${name}" didn't export an object`);
    }
    for (const field of ["name", "description", "authors"]) {
        if (!(field in plugin)) {
            throw new Error(`Plugin "${name}" is missing required field "${field}"`);
        }
    }
}

function registerPlugin(plugin: any) {
    const Plugins = runtime().Plugins; // Vencord.Plugins — the PluginManager module namespace

    // 1. Merge into the same map ~plugins normally populates at build time.
    Plugins.plugins[plugin.name] = plugin;

    // 2. Mark it enabled in Settings BEFORE initPluginManager() runs.
    //    isPluginEnabled() checks Settings.plugins[name]?.enabled — a plugin
    //    present in the map but absent from Settings.plugins is treated as
    //    disabled and initPluginManager() will skip its patches entirely.
    const Settings = runtime().Settings;
    Settings.plugins[plugin.name] ??= { enabled: true };
    Settings.plugins[plugin.name].enabled = true;

    // 3. initPluginManager() only runs ONCE (it's wrapped in onlyOnce()) and
    //    does its own for-loop calling addPatch() per plugin per patch. As
    //    long as steps 1-2 above complete before that call happens in your
    //    Vencord.ts bootstrap (see integration note), you don't need to call
    //    addPatch() yourself — initPluginManager()'s own loop will pick this
    //    plugin up like any built-in one.
    //
    //    If your fork's initPluginManager() has ALREADY run by the time this
    //    executes (e.g. you didn't gate it on initCustomPlugins() finishing),
    //    that loop won't fire again — you'd need to call addPatch() per
    //    patch here manually as a fallback:
    //
    //    if (plugin.patches) {
    //        for (const patch of plugin.patches) Plugins.addPatch(patch, plugin.name);
    //    }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Public entry point
// ─────────────────────────────────────────────────────────────────────────

export interface CustomPluginLoadResult {
    name: string;
    ok: boolean;
    error?: string;
}

/**
 * Call this once, as early as possible in your bootstrap — before Discord's
 * webpack has initialized. Await it before continuing.
 */
export async function initCustomPlugins(): Promise<CustomPluginLoadResult[]> {
    registerCustomPluginsSettingsEntry();

    const stored = await getAllCustomPlugins();
    const results: CustomPluginLoadResult[] = [];

    for (const entry of stored) {
        if (!entry.enabled) {
            results.push({ name: entry.name, ok: true });
            continue;
        }
        results.push(await loadOne(entry));
    }

    return results;
}

async function loadOne(entry: StoredCustomPlugin): Promise<CustomPluginLoadResult> {
    try {
        const exported = await compilePluginSource(entry.source);
        const plugin = exported?.default ?? exported;
        validatePluginShape(plugin, entry.name);
        registerPlugin(plugin);
        return { name: entry.name, ok: true };
    } catch (err) {
        // One bad plugin must never take the whole patcher down.
        console.error(`[CustomPlugins] Failed to load "${entry.name}":`, err);
        return { name: entry.name, ok: false, error: String(err) };
    }
}

/**
 * Re-validates a plugin's source WITHOUT registering it — used by the
 * settings UI to give immediate feedback when a user adds a new plugin,
 * before they reload the client for it to take effect for real.
 */
export async function dryRunCompile(source: string): Promise<{ ok: boolean; error?: string; name?: string }> {
    try {
        const exported = await compilePluginSource(source);
        const plugin = exported?.default ?? exported;
        validatePluginShape(plugin, plugin?.name ?? "(unknown)");
        return { ok: true, name: plugin.name };
    } catch (err) {
        return { ok: false, error: String(err) };
    }
}
