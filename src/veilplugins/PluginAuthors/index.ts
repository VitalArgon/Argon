/*
 * Veil — A Discord Client Modification.
 */

import definePlugin from "@utils/types";
import { Devs, VeilDevs, EquicordDevs } from "@utils/constants"; // Change this if you take this plugin
import { openModal, ModalRoot, ModalHeader, ModalContent, ModalCloseButton, ModalSize } from "@utils/modal";
import { React } from "@webpack/common";
import Plugins from "~plugins";

function h(...args: Parameters<typeof React.createElement>) {
    return React.createElement(...args);
}

interface DevEntry {
    id: string | bigint;
    name: string;
}

const DEV_SOURCES: Record<string, Record<string, DevEntry>> = { Devs, VeilDevs, EquicordDevs };

function findDevEntry(userId: string): DevEntry | null {
    for (const source of Object.values(DEV_SOURCES)) {
        for (const entry of Object.values(source)) {
            if (String(entry.id) === userId) return entry;
        }
    }
    return null;
}

function getPluginsByDev(userId: string): string[] {
    const names: string[] = [];
    for (const [name, plugin] of Object.entries(Plugins)) {
        const authors = (plugin as any).authors ?? [];
        if (authors.some((a: DevEntry) => String(a.id) === userId)) {
            names.push(name);
        }
    }
    return names;
}

function PluginsModal({ modalProps, devName, pluginNames }: { modalProps: any; devName: string; pluginNames: string[]; }) {
    return h(ModalRoot, { ...modalProps, size: ModalSize.SMALL },
        h(ModalHeader, null,
            h("div", { style: { flex: 1, fontWeight: 600 } }, `Plugins by ${devName}`),
            h(ModalCloseButton, { onClick: modalProps.onClose })
        ),
        h(ModalContent, { style: { padding: 16 } },
            pluginNames.length
                ? h("ul", { style: { margin: 0, paddingLeft: 20 } },
                    pluginNames.map(name => h("li", { key: name }, name))
                  )
                : h("div", null, "No plugins found for this dev.")
        )
    );
}

function DevPluginsButton({ userId }: { userId: string; }) {
    const dev = findDevEntry(userId);
    if (!dev) return null;

    const pluginNames = getPluginsByDev(userId);

    return h("button", {
        onClick: () => openModal(modalProps =>
            h(PluginsModal, { modalProps, devName: dev.name, pluginNames })
        ),
        style: {
            background: "var(--button-secondary-background)",
            color: "var(--text-normal)",
            border: "none",
            borderRadius: 4,
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: 12,
        },
    }, `Plugins made (${pluginNames.length})`);
}

export default definePlugin({
    name: "PluginAuthors",
    description: "Shows a profile button linking to a user's authored plugins. (Have to be registered in a devs list)",
    authors: [VeilDevs.Zarak],

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
