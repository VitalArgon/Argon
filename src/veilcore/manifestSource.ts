import { ChannelStore } from "@webpack/common";
import { GuildManifestEntry, StaticOverrides } from "@veilcore/guildplugins/manifest";
import { GuildPlugins } from "@veilcore/guildplugins";

export type { GuildManifestEntry };

const CONFIG_CHANNEL_NAME = "rules";

function findConfigChannel(guildId: string): any | null {
    // returns { channelId: Channel } for the guild — verify this exact
    // method name against your ChannelStore export; it's the common one
    // used across Vencord plugins but confirm before relying on it
    const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
    return Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === CONFIG_CHANNEL_NAME
    ) ?? null;
}

function parseConfig(topic: string | undefined, guildId: string): GuildManifestEntry | null {
    if (!topic) return null;

    try {
        const parsed = JSON.parse(topic);
        if (!Array.isArray(parsed.pluginIds)) return null;

        // only allow plugin ids that actually exist and ship with the
        // client — the config channel can select from what's already
        // bundled, it can never introduce new code
        const validIds = parsed.pluginIds.filter((id: string) => id in GuildPlugins);
        if (validIds.length === 0) return null;

        return {
            guildId,
            guildName: typeof parsed.guildName === "string" ? parsed.guildName : "This server",
            pluginIds: validIds,
            promptOnJoin: parsed.promptOnJoin !== false,
        };
    } catch {
        console.warn(`[Veil] malformed JSON in #${CONFIG_CHANNEL_NAME} topic for guild ${guildId}`);
        return null;
    }
}

export function getEntryForGuild(guildId: string): GuildManifestEntry | null {
    const override = StaticOverrides.find(e => e.guildId === guildId);
    if (override) return override;

    const channel = findConfigChannel(guildId);
    if (!channel) return null;

    return parseConfig(channel.topic, guildId);
}
