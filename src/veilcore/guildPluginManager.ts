import { FluxDispatcher, GuildStore } from "@webpack/common";
import * as DataStore from "@api/DataStore";
import { GuildPlugins } from "@veilcore/guildplugins";
import { getEntryForGuild } from "./manifestSource";

const userEnabledKey = (guildId: string, pluginId: string) => `Veil_guildPlugin_${guildId}_${pluginId}`;

// default true: absence of a stored value means "not yet turned off",
// i.e. still auto-enabled. Only an explicit `false` disables it.
export async function isUserOptedIn(guildId: string, pluginId: string): Promise<boolean> {
    const stored = await DataStore.get(userEnabledKey(guildId, pluginId));
    return stored !== false;
}

export async function setUserOptIn(guildId: string, pluginId: string, enabled: boolean) {
    await DataStore.set(userEnabledKey(guildId, pluginId), enabled);
    enabled ? activate(guildId, pluginId) : deactivate(pluginId);
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
        if (await isUserOptedIn(guildId, pluginId)) {
            activate(guildId, pluginId);
        }
        // no prompt branch anymore — if they'd previously turned it off,
        // it just stays off until they flip it back on in Settings
    }
}

function handleGuildUnavailable(guildId: string) {
    const entry = getEntryForGuild(guildId);
    if (!entry) return;
    for (const pluginId of entry.pluginIds) {
        deactivate(pluginId);
    }
}

export function initGuildPluginManager() {
    FluxDispatcher.subscribe("GUILD_CREATE", ({ guild }: any) => handleGuildAvailable(guild.id));
    FluxDispatcher.subscribe("GUILD_DELETE", ({ guild }: any) => handleGuildUnavailable(guild?.id));

    FluxDispatcher.subscribe("CHANNEL_UPDATE", ({ channel }: any) => {
        if (channel?.name?.toLowerCase() === "veil-plugins" && channel.guild_id) {
            handleGuildAvailable(channel.guild_id);
        }
    });

    for (const guild of Object.values(GuildStore.getGuilds())) {
        handleGuildAvailable((guild as any).id);
    }
}

let subscriptions: (() => void)[] = [];

export function stopGuildPluginManager() {
    for (const pluginId of Object.keys(GuildPlugins)) {
        deactivate(pluginId);
    }
}

function activate(guildId: string, pluginId: string) {
    const plugin = GuildPlugins[pluginId];
    if (!plugin) return;
    if (!plugin.started) plugin.start?.(guildId);
}
