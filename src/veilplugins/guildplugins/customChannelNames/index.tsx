import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";

// Display-only: this does NOT let users create channels with these
// characters (channel creation goes through Discord's REST API and is
// validated server-side, outside the client's control). This only
// changes how already-existing channel names *render* for members who
// have the plugin active in this guild.

// Map of literal substrings -> what to render instead. Keep this narrow
// and explicit rather than a general unicode-passthrough, so you know
// exactly what's being altered.
const DISPLAY_REPLACEMENTS: [RegExp, string][] = [
    [/:star:/g, "★"],
    [/:and:/g, "&"],
    // add more literal -> display mappings as needed
];

function renderCustomName(rawName: string): string {
    let out = rawName;
    for (const [pattern, replacement] of DISPLAY_REPLACEMENTS) {
        out = out.replace(pattern, replacement);
    }
    return out;
}

export default defineGuildPlugin({
    name: "CustomChannelNames",
    description: "Renders special characters/emoji shorthand in this guild's channel names (display-only, cosmetic).",
    authors: [VeilDevs.Zarak],

    patches: [
        {
            // find target: whatever module renders the channel name text
            // in the channel list — locate via patch helper the same way
            // as the sidebar row in part 5, searching for a distinctive
            // string near where channel names are rendered.
            find: '"channel-name"', // placeholder — confirm against the real module
            replacement: {
                match: /(channelName:\s*)(\w+)([,}])/,
                replace: (_m: string, prefix: string, varName: string, suffix: string) =>
                    `${prefix}$self.renderCustomName(${varName})${suffix}`,
            },
        },
    ],

    renderCustomName,

    start() {
        console.log("[Veil] CustomChannelNames activated for its guild");
    },

    stop() {
        console.log("[Veil] CustomChannelNames deactivated");
    },
});
