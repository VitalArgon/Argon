import definePlugin from "@utils/types";

export function defineGuildPlugin(def: Parameters<typeof definePlugin>[0]) {
    return definePlugin(def);
}
