import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";

export default defineGuildPlugin({
    name: "WelcomeBanner",
    description: "Shows a custom banner in this guild's channel list.",
    authors: [VeilDevs.Zarak],

    patches: [
        // your actual channel-list patch here, same as any Equicord plugin
    ],

    start() {
        console.log("[Veil] WelcomeBanner activated for its guild");
    },

    stop() {
        console.log("[Veil] WelcomeBanner deactivated");
    },
});
