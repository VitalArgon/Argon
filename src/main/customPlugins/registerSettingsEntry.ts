/**
 * registerSettingsEntry.ts
 *
 * Pushes a "Custom Plugins" entry into the built-in Settings plugin's
 * `customEntries` array (see src/plugins/_core/settings.tsx — that array
 * is mapped through buildEntry() and merged into the sidebar every time
 * buildLayout() runs), so it shows up as its own sidebar item without
 * touching settings.tsx at all.
 *
 * Must run after "~plugins" has populated the Plugins map (true by the
 * time initCustomPlugins() is called in Vencord.ts) and before the user
 * ever opens Settings. Called from customPluginLoader.ts.
 */

import { PluginsIcon } from "@components/Icons";
import { plugins } from "@api/PluginManager";

import { CustomPluginsTab } from "./CustomPluginsTab";

let registered = false;

export function registerCustomPluginsSettingsEntry() {
    if (registered) return;

    const SettingsPlugin = (plugins as any).Settings;
    if (!SettingsPlugin) {
        console.error("[CustomPlugins] Settings plugin not found on Plugins map — settings tab won't appear.");
        return;
    }

    SettingsPlugin.customEntries.push({
        key: "veil_custom_plugins",
        title: "Custom Plugins",
        Component: CustomPluginsTab,
        Icon: PluginsIcon,
    });

    registered = true;
}
