import definePlugin from "@utils/types";
import { Devs, VeilDevs, EquicordDevs } from "@utils/constants"; // add/change this if you take this plugin
import { React } from "@webpack/common";
import Plugins from "~plugins";

import { openContributorModal as openExistingDevModal } from "@components/PluginSettings/ContributorModal";

function h(...args: Parameters<typeof React.createElement>) {
    return React.createElement(...args);
}

interface DevEntry {
    id: string | bigint;
    name: string;
}

const DEV_SOURCES: Record<string, Record<string, DevEntry>> = { Devs, VeilDevs, EquicordDevs }; // Change this too though

function findDevEntry(userId: string): DevEntry | null {
    for (const source of Object.values(DEV_SOURCES)) {
        for (const entry of Object.values(source)) {
            if (String(entry.id) === userId) return entry;
        }
    }
    return null;
}

function DevPluginsButton({ userId }: { userId: string; }) {
    const dev = findDevEntry(userId);
    if (!dev) return null;

    return h("button", {
        onClick: () => openExistingDevModal(dev),
        style: {
            background: "var(--button-secondary-background)",
            color: "var(--text-normal)",
            border: "none",
            borderRadius: 4,
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: 12,
        },
    }, "Plugins made");
}

export default definePlugin({
    name: "PluginAuthors",
    description: "Shows a profile button linking to a user's authored plugins. (Have to be listed in a Devs list)",
    authors: [VeilDevs.Zarak], // just add me into your devs list if you use this

    patches: [
        {
            find: "TODO_FIND_STRING",
            replacement: {
                match: /TODO_MATCH_REGEX/,
                replace: "TODO_REPLACEMENT",
            },
        },
    ],

    DevPluginsButton,
});
