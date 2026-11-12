/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { initGuildPluginManager, stopGuildPluginManager } from "@argoncore/guildPluginManager";
import { registerGuildPluginsTab } from "@argoncore/registerGuildPluginsTab";
import { ArgonDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "GuildPluginsFramework",
    description: "Activates guild-gated plugins for guilds you're in, and adds the Guild Plugins settings tab.",
    authors: [ArgonDevs.Zarak],
    required: true,

    start() {
        initGuildPluginManager();
        registerGuildPluginsTab();
    },

    stop() {
        stopGuildPluginManager?.();
    },
});
