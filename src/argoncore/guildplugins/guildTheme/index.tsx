/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ArgonDevs } from "@utils/constants";
import { ChannelStore, FluxDispatcher, SelectedGuildStore } from "@webpack/common";

import { defineGuildPlugin } from "../_api/defineGuildPlugin";

const STYLE_ID = "argon-guild-theme";
const CSS_CHANNEL_NAME = "css";

let watchedGuildId: string | null = null;

function getCssForGuild(guildId: string): string | null {
    const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
    const cssChannel = Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === CSS_CHANNEL_NAME
    ) as any;

    return cssChannel?.topic || null;
}

function applyThemeIfActive() {
    const selected = SelectedGuildStore.getGuildId();
    const css = selected && selected === watchedGuildId ? getCssForGuild(selected) : null;

    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

    if (css) {
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
    } else {
        styleEl?.remove();
    }
}

function onChannelUpdate({ channel }: any) {
    if (channel?.guild_id === watchedGuildId && channel?.name?.toLowerCase() === CSS_CHANNEL_NAME) {
        applyThemeIfActive();
    }
}

export default defineGuildPlugin({
    name: "GuildTheme",
    description: "Applies CSS from this guild's #css channel topic while you're viewing it, reverts the moment you switch away.",
    authors: [ArgonDevs.Zarak],

    start(guildId?: string) {
        watchedGuildId = guildId ?? null;
        FluxDispatcher.subscribe("GUILD_SELECT", applyThemeIfActive);
        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.subscribe("CHANNEL_CREATE", onChannelUpdate);
        applyThemeIfActive();
    },

    stop() {
        FluxDispatcher.unsubscribe("GUILD_SELECT", applyThemeIfActive);
        FluxDispatcher.unsubscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.unsubscribe("CHANNEL_CREATE", onChannelUpdate);
        document.getElementById(STYLE_ID)?.remove();
        watchedGuildId = null;
    },
});
