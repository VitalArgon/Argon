/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ArgonDevs } from "@utils/constants";
import { ChannelStore, FluxDispatcher } from "@webpack/common";

import { defineGuildPlugin } from "../_api/defineGuildPlugin";

const NAMES_CHANNEL_NAME = "customnames";
const MAPPING_REGEX = /\{\s*([^{}=]+?)\s*=\s*([^{}]+?)\s*\}/g;
const BASE_REPLACEMENTS: [RegExp, string][] = [[/-/g, " "]];

let watchedGuilds = new Set<string>();
const dynamicReplacements = new Map<string, [RegExp, string][]>();
let originalGetChannel: typeof ChannelStore.getChannel | undefined;
let originalGetMutableGuildChannelsForGuild: typeof ChannelStore.getMutableGuildChannelsForGuild | undefined;

function escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseReplacementsFromTopic(topic: string | null | undefined): [RegExp, string][] {
    const pairs: [RegExp, string][] = [];
    if (!topic) return pairs;

    for (const match of topic.matchAll(MAPPING_REGEX)) {
        const [, shorthand, replacement] = match;
        pairs.push([new RegExp(escapeRegex(shorthand.trim()), "g"), replacement]);
    }

    return pairs;
}

function applyReplacements(guildId: string, text: string) {
    let out = text;
    for (const [pattern, replacement] of BASE_REPLACEMENTS) out = out.replace(pattern, replacement);
    for (const [pattern, replacement] of dynamicReplacements.get(guildId) ?? []) {
        out = out.replace(pattern, replacement);
    }
    return out;
}

function rebuildReplacements(guildId: string) {
    const getChannels = originalGetMutableGuildChannelsForGuild;
    if (!getChannels) return;

    const channels = getChannels.call(ChannelStore, guildId);
    const namesChannel = Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === NAMES_CHANNEL_NAME
    ) as any;

    dynamicReplacements.set(guildId, parseReplacementsFromTopic(namesChannel?.topic));
}

function withDisplayName(channel: any) {
    if (!channel || !watchedGuilds.has(channel.guild_id) || typeof channel.name !== "string") return channel;
    if (channel.name.toLowerCase() === NAMES_CHANNEL_NAME) return channel;

    const displayName = applyReplacements(channel.guild_id, channel.name);
    return displayName === channel.name ? channel : { ...channel, name: displayName };
}

function applyDisplayNamesToGuildChannels(guildId: string) {
    const getChannels = originalGetMutableGuildChannelsForGuild;
    if (!getChannels) return;

    const channels = getChannels.call(ChannelStore, guildId);
    for (const ch of Object.values(channels) as any[]) {
        if (!ch || ch.guild_id !== guildId || typeof ch.name !== "string") continue;
        if (ch.name.toLowerCase() === NAMES_CHANNEL_NAME) continue;

        const displayName = applyReplacements(guildId, ch.name);
        if (displayName !== ch.name) ch.name = displayName;
    }
}

function wrappedGetChannel(channelId: string) {
    return withDisplayName(originalGetChannel?.call(ChannelStore, channelId));
}

function wrappedGetMutableGuildChannelsForGuild(guildId: string) {
    const channels = originalGetMutableGuildChannelsForGuild?.call(ChannelStore, guildId);
    if (!channels || !watchedGuilds.has(guildId)) return channels;

    const patched: Record<string, any> = {};
    for (const [id, channel] of Object.entries(channels)) {
        patched[id] = withDisplayName(channel);
    }
    return patched;
}

function installChannelStoreWrappers() {
    if (!originalGetChannel) originalGetChannel = ChannelStore.getChannel;
    if (!originalGetMutableGuildChannelsForGuild) {
        originalGetMutableGuildChannelsForGuild = ChannelStore.getMutableGuildChannelsForGuild;
    }

    if (ChannelStore.getChannel !== wrappedGetChannel) ChannelStore.getChannel = wrappedGetChannel;
    if (ChannelStore.getMutableGuildChannelsForGuild !== wrappedGetMutableGuildChannelsForGuild) {
        ChannelStore.getMutableGuildChannelsForGuild = wrappedGetMutableGuildChannelsForGuild;
    }
}

function onChannelUpdate({ channel }: any) {
    const guildId = channel?.guild_id;
    if (!guildId || !watchedGuilds.has(guildId)) return;

    if (channel.name?.toLowerCase() === NAMES_CHANNEL_NAME) {
        rebuildReplacements(guildId);
        applyDisplayNamesToGuildChannels(guildId);
    }
}

export default defineGuildPlugin({
    name: "CustomChannelNames",
    description: "Renders custom shorthand substitutions in this guild's channel names via a ChannelStore patch, defined in #customnames' topic as {shorthand = replacement} (display-only, cosmetic).",
    authors: [ArgonDevs.Zarak],

    start(guildId?: string) {
        if (!guildId) return;

        watchedGuilds.add(guildId);
        installChannelStoreWrappers();
        rebuildReplacements(guildId);
        applyDisplayNamesToGuildChannels(guildId);

        FluxDispatcher.subscribe("CHANNEL_CREATE", onChannelUpdate);
        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_CREATE", onChannelUpdate);
        FluxDispatcher.unsubscribe("CHANNEL_UPDATE", onChannelUpdate);

        if (originalGetChannel) ChannelStore.getChannel = originalGetChannel;
        if (originalGetMutableGuildChannelsForGuild) {
            ChannelStore.getMutableGuildChannelsForGuild = originalGetMutableGuildChannelsForGuild;
        }

        originalGetChannel = undefined;
        originalGetMutableGuildChannelsForGuild = undefined;
        watchedGuilds = new Set();
        dynamicReplacements.clear();
    },
});
