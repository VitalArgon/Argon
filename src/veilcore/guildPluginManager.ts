import { FluxDispatcher, GuildStore } from "@webpack/common";
import { GuildPlugins } from "@veilcore/guildplugins";
import { getEntryForGuild } from "./manifestSource";
import { maybeShowInstallPrompt } from "./installPrompt";

// user-level opt-in store — plugin being "unlocked" by the guild is not
// the same as the user having agreed to run it
const userEnabledKey = (guildId: string, pluginId: string) => `Veil_guildPlugin_${guildId}_${pluginId}`;

export function isUserOptedIn(guildId: string, pluginId: string): boolean {
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

function handleGuildAvailable(guildId: string) {
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
    // only deactivate if user isn't currently in ANY other guild
    // that also unlocks this same plugin id
    for (const pluginId of entry.pluginIds) {
        deactivate(pluginId);
    }
}

export function initGuildPluginManager() {
    FluxDispatcher.subscribe("GUILD_CREATE", ({ guild }: any) => handleGuildAvailable(guild.id));
    FluxDispatcher.subscribe("GUILD_DELETE", ({ guild }: any) => handleGuildUnavailable(guild?.id));

    // re-check when the owner edits the #veil-plugins topic while the
    // user is already sitting in the guild — otherwise a live topic
    // change wouldn't take effect until next client restart
    FluxDispatcher.subscribe("CHANNEL_UPDATE", ({ channel }: any) => {
        if (channel?.name?.toLowerCase() === "veil-plugins" && channel.guild_id) {
            handleGuildAvailable(channel.guild_id);
        }
    });

    // catch guilds already loaded at client start
    for (const guild of Object.values(GuildStore.getGuilds())) {
        handleGuildAvailable((guild as any).id);
    }
}
