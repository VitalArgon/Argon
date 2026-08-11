import definePlugin from "@utils/types";
import { ArgonDevs } from "@utils/constants";
import { initGuildPluginManager, stopGuildPluginManager } from "@argoncore/guildPluginManager";
import { registerGuildPluginsTab } from "@argoncore/registerGuildPluginsTab";

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
