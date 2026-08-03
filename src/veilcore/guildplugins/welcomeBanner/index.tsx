import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";

const CHANNEL_LIST_SELECTOR = 'nav[aria-label][class*="sidebar"]'; // confirm actual selector for your client version
const BANNER_ID = "veil-welcome-banner";

function injectBanner(root: ParentNode) {
    const sidebar = root.querySelector(CHANNEL_LIST_SELECTOR);
    if (!sidebar || sidebar.querySelector(`#${BANNER_ID}`)) return;

    const banner = document.createElement("div");
    banner.id = BANNER_ID;
    banner.textContent = "Welcome — this server has custom plugins active";
    sidebar.prepend(banner);
}

let observer: MutationObserver | null = null;

export default defineGuildPlugin({
    name: "WelcomeBanner",
    description: "Shows a custom banner in this guild's channel list.",
    authors: [VeilDevs.Zarak],

    start() {
        injectBanner(document);
        observer = new MutationObserver(() => injectBanner(document));
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
        document.getElementById(BANNER_ID)?.remove();
    },
});
