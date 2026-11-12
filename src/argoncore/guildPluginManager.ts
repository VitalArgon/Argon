/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { GuildPlugins } from "@argoncore/guildplugins";
import { FluxDispatcher, GuildStore } from "@webpack/common";

import { getEntryForGuild } from "./manifestSource";

const CONFIG_CHANNEL_NAME = "rules";

const userEnabledKey = (guildId: string, pluginId: string) => `argon_guildPlugin_${guildId}_${pluginId}`;

/** pluginId -> the guild ids the plugin is currently running for */
const activeGuilds = new Map<string, Set<string>>();
/** event -> handler, so stop() can actually detach what init() attached */
const subscriptions: { event: string; handler: (payload: any) => void; }[] = [];

function listen<T = any>(event: string, handler: (payload: T) => void) {
    FluxDispatcher.subscribe(event, handler as any);
    subscriptions.push({ event, handler: handler as any });
}

export async function isUserOptedIn(guildId: string, pluginId: string): Promise<boolean> {
    const stored = await DataStore.get(userEnabledKey(guildId, pluginId));
    return stored !== false;
}

export async function setUserOptIn(guildId: string, pluginId: string, enabled: boolean) {
    await DataStore.set(userEnabledKey(guildId, pluginId), enabled);
    if (enabled) activate(guildId, pluginId);
    else deactivate(guildId, pluginId);
}

function activate(guildId: string, pluginId: string) {
    const plugin = GuildPlugins[pluginId];
    if (!plugin) return;

    let guilds = activeGuilds.get(pluginId);
    if (!guilds) {
        guilds = new Set();
        activeGuilds.set(pluginId, guilds);
    }

    // Already running for this guild: a CHANNEL_UPDATE must not start it twice.
    if (guilds.has(guildId)) return;
    guilds.add(guildId);

    // One guild at a time: leaving a guild no longer stops the plugin in the
    // others, because the guild id is tracked instead of a single flag.
    (plugin as any).start?.(guildId);
}

function deactivate(guildId: string, pluginId: string) {
    const plugin = GuildPlugins[pluginId];
    if (!plugin) return;

    const guilds = activeGuilds.get(pluginId);
    if (!guilds?.delete(guildId)) return;

    if (guilds.size === 0) {
        activeGuilds.delete(pluginId);
        (plugin as any).stop?.();
    }
}

function deactivateEverywhere(pluginId: string) {
    if (!activeGuilds.delete(pluginId)) return;
    (GuildPlugins[pluginId] as any)?.stop?.();
}

async function handleGuildAvailable(guildId: string | undefined) {
    if (!guildId) return;

    try {
        const entry = getEntryForGuild(guildId);
        if (!entry) return;

        // Read every opt-in at once instead of one sequential round trip each,
        // which is what made startup slow for anyone in a lot of servers.
        const optIns = await Promise.all(
            entry.pluginIds.map(async pluginId => [pluginId, await isUserOptedIn(guildId, pluginId)] as const)
        );

        for (const [pluginId, optedIn] of optIns) {
            // No prompt branch: a plugin the user turned off stays off until
            // they flip it back on in Settings.
            if (optedIn) activate(guildId, pluginId);
            else deactivate(guildId, pluginId);
        }
    } catch (err) {
        console.error("[Argon] failed to load guild plugins for", guildId, err);
    }
}

function handleGuildUnavailable(guildId: string | undefined) {
    if (!guildId) return;

    try {
        const entry = getEntryForGuild(guildId);
        if (entry) {
            for (const pluginId of entry.pluginIds) deactivate(guildId, pluginId);
        }

        // The guild may already be gone from the store, so clean up anything
        // still running for an id the manifest no longer resolves.
        for (const [pluginId, guilds] of activeGuilds) {
            if (guilds.has(guildId)) deactivate(guildId, pluginId);
        }
    } catch (err) {
        console.error("[Argon] failed to unload guild plugins for", guildId, err);
    }
}

export function initGuildPluginManager() {
    listen("GUILD_CREATE", ({ guild }: any) => {
        void handleGuildAvailable(guild?.id);
    });
    listen("GUILD_DELETE", ({ guild }: any) => handleGuildUnavailable(guild?.id));
    listen("CHANNEL_UPDATE", ({ channel }: any) => {
        if (channel?.guild_id && channel?.name?.toLowerCase() === CONFIG_CHANNEL_NAME) {
            // The manifest lives in the config channel's topic, so a topic
            // edit is the only update worth re-reading.
            void handleGuildAvailable(channel.guild_id);
        }
    });

    for (const guild of Object.values(GuildStore.getGuilds())) {
        void handleGuildAvailable((guild as any)?.id);
    }
}

export function stopGuildPluginManager() {
    for (const pluginId of Object.keys(GuildPlugins)) deactivateEverywhere(pluginId);

    for (const { event, handler } of subscriptions.splice(0)) {
        try {
            FluxDispatcher.unsubscribe(event, handler);
        } catch (err) {
            console.error("[Argon] failed to unsubscribe a guild plugin listener", err);
        }
    }
}
