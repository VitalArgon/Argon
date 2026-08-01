import definePlugin from "@utils/types";
import { Devs, VeilDevs, EquicordDevs } from "@utils/constants"; // Change this if you want to take this plugin
import { React } from "@webpack/common";
import { User } from "@vencord/discord-types";
import { openContributorModal } from "@components/settings/tabs/plugins/ContributorModal";

function h(...args: Parameters<typeof React.createElement>) {
    return React.createElement(...args);
}

interface DevEntry {
    id: string | bigint;
    name: string;
}

const DEV_SOURCES: Record<string, Record<string, DevEntry>> = { Devs, VeilDevs, EquicordDevs }; // And change this

function isDev(userId: string): boolean {
    return Object.values(DEV_SOURCES).some(source =>
        Object.values(source).some(entry => String(entry.id) === userId)
    );
}

function DevPluginsButton({ user }: { user: User; }) {
    if (!isDev(user.id)) return null;

    return h("button", {
        onClick: () => openContributorModal(user),
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
    description: "Shows a profile button linking to a user's authored plugins. (user needs to be in a devs list)",
    authors: [VeilDevs.Zarak], // but add me to your devs list
    dependencies: ["ProfileCollectionsAPI"],

    patches: [
        {
            find: "TODO_FIND_STRING",
            replacement: {
                match: /TODO_MATCH_REGEX/,
                replace: "TODO_REPLACEMENT",
            },
        },
    ],

    // Render the button inside profile collections (profile popout / profile modal area)
    renderProfileCollection: {
        render: (props: { user: User; isSideBar?: boolean; }) => {
            return h(DevPluginsButton, { user: props.user });
        },
        priority: 0,
    },

    DevPluginsButton,
});
