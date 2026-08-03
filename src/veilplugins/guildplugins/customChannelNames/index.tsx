// src/veilplugins/guildplugins/customChannelNames/index.tsx

import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";

// Display-only: this does NOT let users create channels with these
// characters (channel creation goes through Discord's REST API and is
// validated server-side, outside the client's control). This only
// changes how already-existing channel names *render* for members who
// have the plugin active in this guild.

const CHANNEL_LINK_SELECTOR = 'a[data-list-item-id^="channels___"]';
const NAME_CONTAINER_SELECTOR = 'div[class*="name__"]';

// Map of literal substrings -> what to render instead. Keep this narrow
// and explicit rather than a general unicode-passthrough, so you know
// exactly what's being altered.
const DISPLAY_REPLACEMENTS: [RegExp, string][] = [
    [/:star:/g, "★"],
    [/:and:/g, "&"],
    // add more literal -> display mappings as needed
];

function applyReplacements(text: string) {
    let out = text;
    for (const [pattern, replacement] of DISPLAY_REPLACEMENTS) {
        out = out.replace(pattern, replacement);
    }
    return out;
}

function processChannelLink(link: Element) {
    const nameEl = link.querySelector(NAME_CONTAINER_SELECTOR);
    if (!nameEl) return;
    const walker = document.createTreeWalker(nameEl, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (node.nodeValue) {
            const replaced = applyReplacements(node.nodeValue);
            if (replaced !== node.nodeValue) node.nodeValue = replaced;
        }
    }
}

function processAll(root: ParentNode) {
    root.querySelectorAll(CHANNEL_LINK_SELECTOR).forEach(processChannelLink);
}

let observer: MutationObserver | null = null;

export default defineGuildPlugin({
    name: "CustomChannelNames",
    description: "Renders special characters/emoji shorthand in this guild's channel names (display-only, cosmetic).",
    authors: [VeilDevs.Zarak],

    start() {
        processAll(document);
        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (!(node instanceof Element)) return;
                    if (node.matches(CHANNEL_LINK_SELECTOR)) {
                        processChannelLink(node);
                    } else {
                        processAll(node);
                    }
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
    },
});
