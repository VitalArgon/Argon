/*
 * Argon — A discord client modification.
 */

import definePlugin from "@utils/types";
import { ArgonDevs } from "@utils/constants";

const CHANNEL_LINK_SELECTOR = 'a[data-list-item-id^="channels___"]';
const NAME_CONTAINER_SELECTOR = 'div[class*="name__"]';

function stripHyphens(text: string) {
    return text.replace(/-/g, " ");
}

function processChannelLink(link: Element) {
    const nameEl = link.querySelector(NAME_CONTAINER_SELECTOR);
    if (!nameEl) return;

    const walker = document.createTreeWalker(nameEl, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.includes("-")) {
            node.nodeValue = stripHyphens(node.nodeValue);
        }
    }
}

function processAll(root: ParentNode) {
    root.querySelectorAll(CHANNEL_LINK_SELECTOR).forEach(processChannelLink);
}

let observer: MutationObserver | null = null;

export default definePlugin({
    name: "SpacedOut",
    description: "Replaces hyphens with spaces in channel names.",
    authors: [ArgonDevs.Zarak],

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
