import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { ArgonDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore, ChannelStore, RestAPI } from "@webpack/common";

console.log("[CategoryBanners] module loaded");

const BANNER_CHANNEL_NAME = "categorybanners";
const BANNER_CLASS = "argon-category-banner";
// Mapping syntax: {categoryName = messageId}
const MAPPING_REGEX = /\{\s*([^{}=]+?)\s*=\s*(\d{17,20})\s*\}/g;

const SPACER_DATA_ATTR = "argonBannerSpacer";
const SHIFT_DATA_ATTR = "argonBannerShift";
const PREV_POSITION_ATTR = "argonPrevPosition";
const PREV_MARGIN_ATTR = "argonPrevMargin";
const PREV_TOP_ATTR = "argonPrevTop";
const PREV_Z_ATTR = "argonPrevZ";
const PREV_TRANSFORM_ATTR = "argonPrevTransform";

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
        return lower.replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, " ").trim();
    } catch {
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
        newMap.set(name, url);
        if (!/^\d{17,20}$/.test(name)) {
            const cat = Object.values(guildChannels).find((c: any) => c.type === 4 && normalizeName(c.name) === name);
            if (cat) newMap.set(cat.id, url);
        }
    }));
    bannerMap = newMap;
    console.log("[CategoryBanners] bannerMap rebuilt", bannerMap);
}

function findRowRoot(el: HTMLElement): HTMLElement {
    const RATIO_THRESHOLD = 2.5;
    const MIN_JUMP_PX = 40;
    const MAX_DEPTH = 8;

    let cur: HTMLElement = el;
    for (let i = 0; i < MAX_DEPTH; i++) {
        const parent = cur.parentElement;
        if (!parent) break;

        const curHeight = cur.getBoundingClientRect().height || 1;
        const parentHeight = parent.getBoundingClientRect().height || 1;

        const bigJump = parentHeight / curHeight > RATIO_THRESHOLD
            && (parentHeight - curHeight) > MIN_JUMP_PX;

        if (bigJump) return cur; // parent is the list container — cur is the row

        cur = parent;
    }
    return cur;
}

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

    const headerButtons = Array.from(
        document.querySelectorAll('[role="treeitem"][aria-expanded], [role="button"][aria-expanded]')
    ) as HTMLElement[];
    if (!headerButtons.length) return;

    headerButtons.forEach(btn => {
        const titleEl = btn.querySelector('[class*="title-"]') as HTMLElement | null;
        const rawName = (titleEl?.textContent ?? btn.textContent) || "";
        const name = normalizeName(rawName);
        if (!name) return;

        const cat = Object.values(guildChannels).find((c: any) => c.type === 4 && normalizeName(c.name) === name);
        const url = (cat && bannerMap.get(cat.id)) ?? bannerMap.get(name);
        if (!url) return;

        const row = findRowRoot(btn);
        const previous = row.previousElementSibling;
        if (previous?.classList?.contains(BANNER_CLASS)) return;

        const banner = document.createElement("img");
        banner.src = url;
        banner.className = BANNER_CLASS;
        banner.style.cssText = "width:75%;border-radius:16px;margin:4px auto 1px;display:block;object-fit:cover;position:relative;z-index:10;";

        const applyShift = () => {
            const height = banner.offsetHeight || banner.getBoundingClientRect().height || 0;
            if (!height) return;

            row.dataset[PREV_POSITION_ATTR] = row.style.position ?? "";
            row.dataset[PREV_MARGIN_ATTR] = row.style.marginTop ?? "";
            row.dataset[PREV_TOP_ATTR] = row.style.top ?? "";
            row.dataset[PREV_Z_ATTR] = row.style.zIndex ?? "";
            row.dataset[PREV_TRANSFORM_ATTR] = row.style.transform ?? "";
            row.dataset[SHIFT_DATA_ATTR] = String(height);

            const computed = window.getComputedStyle(row);
            const isAbsolute = computed.position === "absolute" || computed.position === "fixed";

            if (isAbsolute) {
                // Out-of-flow row: inserting the banner before it does nothing
                // on its own, so we need an explicit spacer to reserve space.
                const spacer = document.createElement("div");
                spacer.dataset[SPACER_DATA_ATTR] = "1";
                spacer.style.height = `${height}px`;
                spacer.style.width = "100%";
                spacer.style.margin = "4px 0";
                row.parentElement?.insertBefore(spacer, row);
            }
            // Normal flow row: the banner is already a real sibling in the
            // document, so it naturally pushes `row` down — no extra
            // marginTop needed here, adding one would double the gap.
        };

        // Insert the banner as a sibling of the ROW, not the inner button —
        // this is what makes it a genuine new row in the list.
        row.parentElement?.insertBefore(banner, row);

        if (banner.complete && banner.naturalHeight !== 0) {
            applyShift();
        } else {
            banner.addEventListener("load", applyShift, { once: true });
            setTimeout(() => {
                if (!row.dataset[SHIFT_DATA_ATTR]) applyShift();
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
    authors: [ArgonDevs.Zarak],
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
