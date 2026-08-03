import { PluginsIcon } from "@components/Icons"; // swap for a custom icon later if you want
import GuildPluginsSettings from "./guildPluginsSettings";

const ENTRY_KEY = "veil_guild_plugins";

export function registerGuildPluginsTab() {
    const settingsPlugin = (window as any).Vencord?.Plugins?.plugins?.["Settings"];
    if (!settingsPlugin) {
        console.warn("[Veil] Settings plugin not found — Guild Plugins tab not registered");
        return;
    }

    // guard against double-registration (e.g. hot reload during dev)
    if (settingsPlugin.customEntries.some((e: any) => e.key === ENTRY_KEY)) return;

    settingsPlugin.customEntries.push({
        key: ENTRY_KEY,
        title: "Guild Plugins",
        Component: GuildPluginsSettings,
        Icon: PluginsIcon,
    });
}
