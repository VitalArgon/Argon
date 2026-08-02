import definePlugin, { PluginDef } from "@utils/types";

export function defineGuildPlugin(def: PluginDef) {
    return definePlugin(def);
}
