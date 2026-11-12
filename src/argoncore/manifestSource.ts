/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildPlugins } from "@argoncore/guildplugins";
import { GuildManifestEntry, StaticOverrides } from "@argoncore/guildplugins/manifest";
import { ChannelStore } from "@webpack/common";

export type { GuildManifestEntry };

const CONFIG_CHANNEL_NAME = "rules";

function findConfigChannel(guildId: string): any | null {
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

        const validIds = parsed.pluginIds.filter((id: string) => id in GuildPlugins);
        if (validIds.length === 0) return null;

        return {
            guildId,
            guildName: typeof parsed.guildName === "string" ? parsed.guildName : "This server",
            pluginIds: validIds,
            promptOnJoin: parsed.promptOnJoin !== false,
        };
    } catch {
        console.warn(`[Argon] malformed JSON in #${CONFIG_CHANNEL_NAME} topic for guild ${guildId}`);
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
