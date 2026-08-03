import { FluxDispatcher } from "@webpack/common";
import { GuildPlugins } from "@veilcore/guildplugins";
import { getEntryForGuild, loadManifest } from "./manifestSource";
import { maybeShowInstallPrompt } from "./installPrompt";

// user-level opt-in store — plugin being "unlocked" by the guild is not
// the same as the user having agreed to run it
const userEnabledKey = (guildId: string, pluginId: string) => `Veil_guildPlugin_${guildId}_${pluginId}`;

function isUserOptedIn(guildId: string, pluginId: string): boolean {
    return localStorage.getItem(userEnabledKey(guildId, pluginId)) === "true";
}

export function setUserOptIn(guildId: string, pluginId: string, enabled: boolean) {
    localStorage.setItem(userEnabledKey(guildId, pluginId), String(enabled));
    enabled ? activate(guildId, pluginId) : deactivate(pluginId);
}

function activate(guildId: string, pluginId: string) {
    const plugin = GuildPlugins[pluginId];
    if (!plugin) return;
    if (!plugin.started) plugin.start?.();
}

function deactivate(pluginId: string) {
    const plugin = GuildPlugins[pluginId];
    if (!plugin) return;
    if (plugin.started) plugin.stop?.();
}

async function handleGuildAvailable(guildId: string) {
    const entry = getEntryForGuild(guildId);
    if (!entry) return;

    for (const pluginId of entry.pluginIds) {
        if (isUserOptedIn(guildId, pluginId)) {
            activate(guildId, pluginId);
        } else if (entry.promptOnJoin) {
            maybeShowInstallPrompt(entry, pluginId);
        }
    }
}

function handleGuildUnavailable(guildId: string) {
    const entry = getEntryForGuild(guildId);
    if (!entry) return;
    // only deactivate if user isn't currently in ANY other manifest guild
    // that also unlocks this same plugin id
    for (const pluginId of entry.pluginIds) {
        deactivate(pluginId);
    }
}

export async function initGuildPluginManager() {
    await loadManifest();

    FluxDispatcher.subscribe("GUILD_CREATE", ({ guild }: any) => handleGuildAvailable(guild.id));
    FluxDispatcher.subscribe("GUILD_DELETE", ({ guild }: any) => handleGuildUnavailable(guild?.id));

    // catch guilds already loaded at client start
    const { GuildStore } = require("@webpack/common");
    for (const guild of Object.values(GuildStore.getGuilds())) {
        handleGuildAvailable((guild as any).id);
    }
}
