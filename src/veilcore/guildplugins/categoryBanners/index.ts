// Fixed CategoryBanners plugin for Equicord
import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore, ChannelStore, RestAPI } from "@webpack/common";

console.log("[CategoryBanners] module loaded");

const BANNER_CHANNEL_NAME = "categorybanners";
const BANNER_CLASS = "veil-category-banner";
// Mapping syntax: {categoryName = messageId}
const MAPPING_REGEX = /\{\s*([^{}=]+?)\s*=\s*(\d{17,20})\s*\}/g;

const SPACER_DATA_ATTR = "veilBannerSpacer";
const SHIFT_DATA_ATTR = "veilBannerShift";
const PREV_POSITION_ATTR = "veilPrevPosition";
const PREV_MARGIN_ATTR = "veilPrevMargin";
const PREV_TOP_ATTR = "veilPrevTop";
const PREV_Z_ATTR = "veilPrevZ";
const PREV_TRANSFORM_ATTR = "veilPrevTransform";

let watchedGuildId: string | null = null;
let bannerMap: Map<string, string> = new Map(); // name|id → image URL
let observer: MutationObserver | null = null;

/** Find the dedicated channel that holds banner mappings */
function findBannerChannel(guildId: string) {
    const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
    return Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === BANNER_CHANNEL_NAME
    ) as any;
}

/** Normalise a category name – lower‑case, trim and strip unsupported characters */
function normalizeName(raw?: string) {
    if (!raw) return "";
    const lower = raw.trim().toLowerCase();
    try {
        // Unicode‑safe version (may throw on older JS engines)
        return lower.replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, " ").trim();
    } catch {
        // Fallback to ASCII only
        return lower.replace(/[^a-z0-9\s_-]/g, "").replace(/\s+/g, " ").trim();
    }
}

/** Parse the topic of the banner channel into {name, msgId} pairs */
function parseMappingsFromTopic(topic: string | null | undefined) {
    const mappings: { name: string; msgId: string }[] = [];
    if (!topic) return mappings;
    for (const match of topic.matchAll(MAPPING_REGEX)) {
        const [, rawName, msgId] = match;
        mappings.push({ name: normalizeName(rawName), msgId });
    }
    return mappings;
}

/** Fetch a single message given channel‑ and message‑ids */
async function fetchMessage(channelId: string, messageId: string) {
    const res = await RestAPI.get({
        url: `/channels/${channelId}/messages`,
        query: { limit: 1, around: messageId },
    });
    const msgs = res.body as any[];
    return msgs.find(m => m.id === messageId) ?? null;
}

/** Build a map of category identifier → banner URL */
async function rebuildBannerMap(guildId: string) {
    const channel = findBannerChannel(guildId);
    if (!channel) {
        bannerMap = new Map();
        return;
    }
    const mappings = parseMappingsFromTopic(channel.topic);
    const newMap = new Map<string, string>();
    const guildChannels = ChannelStore.getMutableGuildChannelsForGuild(guildId) || {};

    await Promise.all(mappings.map(async ({ name, msgId }) => {
        const msg = await fetchMessage(channel.id, msgId);
        const url = msg?.attachments?.[0]?.url;
        if (!url) return;
        // store by the raw key (could be name or numeric ID)
        newMap.set(name, url);
        // if the key is a name, also map the category's **ID** for faster lookup later
        if (!/^\d{17,20}$/.test(name)) {
            const cat = Object.values(guildChannels).find((c: any) => c.type === 4 && normalizeName(c.name) === name);
            if (cat) newMap.set(cat.id, url);
        } else {
            // numeric key – already stored, nothing else to do
        }
    }));
    bannerMap = newMap;
    console.log("[CategoryBanners] bannerMap rebuilt", bannerMap);
}

/** Remove all injected banners and restore original styles */
function clearBanners() {
    document.querySelectorAll(`.${BANNER_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`[data-${SPACER_DATA_ATTR}]`).forEach(el => el.remove());
    document.querySelectorAll(`[data-${SHIFT_DATA_ATTR}]`).forEach((el: Element) => {
        const e = el as HTMLElement;
        e.style.position = e.dataset[PREV_POSITION_ATTR] ?? "";
        e.style.marginTop = e.dataset[PREV_MARGIN_ATTR] ?? "";
        e.style.top = e.dataset[PREV_TOP_ATTR] ?? "";
        e.style.zIndex = e.dataset[PREV_Z_ATTR] ?? "";
        e.style.transform = e.dataset[PREV_TRANSFORM_ATTR] ?? "";
        // clean up bookkeeping attributes
        delete e.dataset[SHIFT_DATA_ATTR];
        delete e.dataset[PREV_POSITION_ATTR];
        delete e.dataset[PREV_MARGIN_ATTR];
        delete e.dataset[PREV_TOP_ATTR];
        delete e.dataset[PREV_Z_ATTR];
        delete e.dataset[PREV_TRANSFORM_ATTR];
    });
}

/** Insert banners above each category button */
function injectBanners() {
    if (!bannerMap.size) return;
    const guildId = SelectedGuildStore.getGuildId();
    if (!guildId) return;
    const guildChannels = ChannelStore.getMutableGuildChannelsForGuild(guildId) || {};

    // Discord uses role="treeitem" for category headers – fallback to role="button" for older builds
    const headerButtons = Array.from(
        document.querySelectorAll('[role="treeitem"][aria-expanded], [role="button"][aria-expanded]')
    ) as HTMLElement[];
    if (!headerButtons.length) return;

    headerButtons.forEach(btn => {
        // Grab the visible title text
        const titleEl = btn.querySelector('[class*="title-"]') as HTMLElement | null;
        const rawName = (titleEl?.textContent ?? btn.textContent) || "";
        const name = normalizeName(rawName);
        if (!name) return;

        // Prevent duplicate banners for the same header
        const previous = btn.previousElementSibling;
        if (previous?.classList?.contains(BANNER_CLASS)) return;

        // Resolve banner URL – prefer ID mapping then name mapping
        const cat = Object.values(guildChannels).find((c: any) => c.type === 4 && normalizeName(c.name) === name);
        const url = (cat && bannerMap.get(cat.id)) ?? bannerMap.get(name);
        if (!url) return;

        const banner = document.createElement("img");
        banner.src = url;
        banner.className = BANNER_CLASS;
        banner.style.cssText = "width:100%;border-radius:4px;margin:4px 0;display:block;object-fit:cover;position:relative;z-index:10;";

        const applyShift = () => {
            const height = banner.offsetHeight || banner.getBoundingClientRect().height || 0;
            if (!height) return;
            // Store original inline styles
            btn.dataset[PREV_POSITION_ATTR] = btn.style.position ?? "";
            btn.dataset[PREV_MARGIN_ATTR] = btn.style.marginTop ?? "";
            btn.dataset[PREV_TOP_ATTR] = btn.style.top ?? "";
            btn.dataset[PREV_Z_ATTR] = btn.style.zIndex ?? "";
            btn.dataset[PREV_TRANSFORM_ATTR] = btn.style.transform ?? "";
            btn.dataset[SHIFT_DATA_ATTR] = String(height);

            const computed = window.getComputedStyle(btn);
            const isAbsolute = computed.position === "absolute" || computed.position === "fixed";

            if (isAbsolute) {
                const spacer = document.createElement("div");
                spacer.dataset[SPACER_DATA_ATTR] = "1";
                spacer.style.height = `${height}px`;
                spacer.style.width = "100%";
                spacer.style.margin = "4px 0";
                btn.parentElement?.insertBefore(spacer, btn);
            } else {
                if (!btn.style.position) btn.style.position = "relative";
                btn.style.zIndex = btn.style.zIndex || "0";
                btn.style.marginTop = `${height}px`;
            }
        };

        // Insert banner directly before the header button
        btn.parentElement?.insertBefore(banner, btn);

        if (banner.complete && banner.naturalHeight !== 0) {
            applyShift();
        } else {
            banner.addEventListener("load", applyShift, { once: true });
            // Fallback in case load never fires (e.g., cached image)
            setTimeout(() => {
                if (!btn.dataset[SHIFT_DATA_ATTR]) applyShift();
            }, 400);
        }
    });
}

function refresh() {
    clearBanners();
    injectBanners();
}

async function applyIfActive() {
    const selected = SelectedGuildStore.getGuildId();
    if (selected && selected === watchedGuildId) {
        await rebuildBannerMap(selected);
        refresh();
    } else {
        clearBanners();
    }
}

function onChannelUpdate({ channel }: any) {
    if (channel?.guild_id === watchedGuildId && channel?.name?.toLowerCase() === BANNER_CHANNEL_NAME) {
        applyIfActive();
    }
}

export default defineGuildPlugin({
    name: "CategoryBanners",
    description: "Shows a banner image above each category, based on mappings in #categorybanners (topic format: {categoryName = messageId}).",
    authors: [VeilDevs.Zarak],
    start(guildId?: string) {
        watchedGuildId = guildId ?? null;
        FluxDispatcher.subscribe("CHANNEL_SELECT", applyIfActive);
        FluxDispatcher.subscribe("GUILD_SELECT", applyIfActive);
        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);

        observer = new MutationObserver(() => injectBanners());
        const root = document.querySelector('[class*="sidebar-"]');
        if (root) observer.observe(root, { childList: true, subtree: true });

        applyIfActive();
    },
    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", applyIfActive);
        FluxDispatcher.unsubscribe("GUILD_SELECT", applyIfActive);
        FluxDispatcher.unsubscribe("CHANNEL_UPDATE", onChannelUpdate);
        observer?.disconnect();
        observer = null;
        clearBanners();
        bannerMap = new Map();
        watchedGuildId = null;
    },
});
