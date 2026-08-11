import definePlugin from "@utils/types";
import { VeilDevs } from "@utils/constants";
import { initGuildPluginManager, stopGuildPluginManager } from "@veilcore/guildPluginManager";
import { registerGuildPluginsTab } from "@veilcore/registerGuildPluginsTab";

export default definePlugin({
    name: "GuildPluginsFramework",
    description: "Activates guild-gated plugins for guilds you're in, and adds the Guild Plugins settings tab.",
    authors: [VeilDevs.Zarak],
    required: true,

    start() {
        initGuildPluginManager();
        registerGuildPluginsTab();
    },

    stop() {
        stopGuildPluginManager?.();
    },
});
