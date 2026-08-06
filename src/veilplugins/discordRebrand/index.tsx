import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

import { VEIL_LOGO_DATA_URI } from "./veilLogo";

// Selectors for every spot we've confirmed the stock Discord logo shows up.
// Discord's own hashed classnames rotate on every build, so we deliberately
// key off attributes that survive redesigns (aria-label / alt / asset name)
// instead. If you spot a logo we're missing, inspect it in devtools and add
// a matching selector here.
const LOGO_SELECTORS = [
    'svg[aria-label="Discord" i]',
    '[aria-label="Discord" i] > svg',
    'img[alt="Discord" i]',
    'img[src*="discord-logo" i]',
    'img[src*="clyde" i]'
].join(", ");

const STYLE_ID = "veilRebrandStyle";
const SWAP_CLASS = "veilRebrand-logoSwap";

const settings = definePluginSettings({
    tintColor: {
        type: OptionType.STRING,
        description: "Color used for the swapped-in logo (hex). Leave as white for the default look.",
        default: "#ffffff"
    }
});

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        :root {
            --veil-logo-mask: url("${VEIL_LOGO_DATA_URI}");
        }
        .${SWAP_CLASS} {
            position: relative;
            display: inline-block;
        }
        .${SWAP_CLASS} > svg,
        .${SWAP_CLASS} > img {
            visibility: hidden;
        }
        .${SWAP_CLASS}::after {
            content: "";
            position: absolute;
            inset: 0;
            background-color: ${settings.store.tintColor || "#ffffff"};
            -webkit-mask-image: var(--veil-logo-mask);
            mask-image: var(--veil-logo-mask);
            -webkit-mask-size: contain;
            mask-size: contain;
            -webkit-mask-repeat: no-repeat;
            mask-repeat: no-repeat;
            -webkit-mask-position: center;
            mask-position: center;
        }
    `;
    document.head.appendChild(style);
}

function removeStyle() {
    document.getElementById(STYLE_ID)?.remove();
}

function tagMatches(root: ParentNode = document) {
    root.querySelectorAll(LOGO_SELECTORS).forEach(el => {
        const target = el.tagName === "SVG" || el.tagName === "IMG" ? el.parentElement : el;
        target?.classList.add(SWAP_CLASS);
    });
}

function untagAll() {
    document.querySelectorAll(`.${SWAP_CLASS}`).forEach(el => el.classList.remove(SWAP_CLASS));
}

let observer: MutationObserver | null = null;

export default definePlugin({
    name: "DiscordRebrand",
    description: "Replaces Discord's logo throughout the client with a solid white Veil logo.",
    authors: [Devs.Nobody], // TODO: swap in your own entry from Devs / add yourself there
    settings,

    start() {
        injectStyle();
        tagMatches();

        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node instanceof Element) tagMatches(node);
                    });
                }
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
        untagAll();
        removeStyle();
    }
});
