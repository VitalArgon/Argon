import { getEntryForGuild } from "./manifestSource";
import { openGuildPluginsPanel } from "./guildPluginsPanel"; // your own panel/modal

export const guildPluginsSidebarPatch = {
    // find target: the module containing the quick-access row list
    find: '"Channels & Roles"', // replace with whatever your search actually turns up
    replacement: {
        match: /(\(0,\w+\.jsxs?\)\(\w+,\{[^}]*label:"Channels & Roles"[^}]*\}\))/,
        replace: (fullMatch: string) =>
            `${fullMatch},$self.maybeRenderGuildPluginsRow(arguments[0])`,
    },
};

export function maybeRenderGuildPluginsRow(props: any) {
    const guildId = props?.guild?.id;
    if (!guildId) return null;

    const entry = getEntryForGuild(guildId);
    if (!entry) return null; // no row at all if this guild has nothing unlocked

    return (
        // reuse whatever row component the found module uses, e.g.:
        // <QuickAccessRow icon={PluginIcon} label="Guild Plugins" onClick={...} />
        null
    );
}
