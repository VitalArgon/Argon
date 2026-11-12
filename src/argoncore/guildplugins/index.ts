/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import CategoryBanners from "./categoryBanners";
import ChannelPopups from "./channelPopups";
import CustomChannelNames from "./customChannelNames";
import GuildTheme from "./guildTheme";

export const GuildPlugins: Record<string, ReturnType<typeof import("./_api/defineGuildPlugin").defineGuildPlugin>> = {
    guildTheme: GuildTheme,
    customChannelNames: CustomChannelNames,
    channelPopups: ChannelPopups,
    categoryBanners: CategoryBanners,
};
