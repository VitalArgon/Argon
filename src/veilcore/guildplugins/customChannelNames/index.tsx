import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";

// Right-click -> Inspect on each of these in your own client to confirm/adjust
// selectors — Discord's class names are hashed per build and can drift.
const TEXT_TARGET_SELECTOR = [
    'a[data-list-item-id^="channels___"] div[class*="name__"]', // sidebar link
    '[class*="title__"]',                                       // chat header title bar
    '[class*="emptyStateHeader"], h3[class*="title"]',           // "Welcome to #X!" heading
].join(", ");

const MESSAGE_TEXTAREA_SELECTOR = 'div[role="textbox"][aria-label^="Message"]';

const DISPLAY_REPLACEMENTS: [RegExp, string][] = [
    [/⋅⋅/g, " "],
    [/⋅and⋅/g, "&"],
    [/⋅slash⋅/g, "/"],
    [/⋅money⋅/g, "$"],
    [/⋅ton⋅/g, "This is a super long channel name exclusive to Veil users who have custom channel names guild plugin enabled on their guild, so this long ass channel name is a reward for that progress"],
];

function applyReplacements(text: string) {
    let out = text;
    for (const [pattern, replacement] of DISPLAY_REPLACEMENTS) {
        out = out.replace(pattern, replacement);
    }
    return out;
}

function processTextNodesIn(el: Element) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (node.nodeValue) {
            const replaced = applyReplacements(node.nodeValue);
            if (replaced !== node.nodeValue) node.nodeValue = replaced;
        }
    }
}

function processMessagePlaceholder(el: Element) {
    // Discord sets the visible placeholder via aria-label AND a data-slate
    // placeholder node's text — aria-label is the reliable one to patch
    const label = el.getAttribute("aria-label");
    if (label) {
        const replaced = applyReplacements(label);
        if (replaced !== label) el.setAttribute("aria-label", replaced);
    }
}

function processAll(root: ParentNode) {
    root.querySelectorAll(TEXT_TARGET_SELECTOR).forEach(processTextNodesIn);
    root.querySelectorAll(MESSAGE_TEXTAREA_SELECTOR).forEach(processMessagePlaceholder);
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
                    processAll(node);
                });
                // aria-label changes on the textarea don't fire childList
                // mutations — need attribute watching for those specifically
                if (mutation.type === "attributes" && mutation.target instanceof Element) {
                    if (mutation.target.matches(MESSAGE_TEXTAREA_SELECTOR)) {
                        processMessagePlaceholder(mutation.target);
                    }
                }
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["aria-label"],
        });
    },

    stop() {
        observer?.disconnect();
        observer = null;
    },
});
