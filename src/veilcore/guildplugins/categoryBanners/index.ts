import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore, ChannelStore, RestAPI } from "@webpack/common";

console.log("[CategoryBanners] module loaded");

const BANNER_CHANNEL_NAME = "categorybanners";
const BANNER_CLASS = "veil-category-banner";
const MAPPING_REGEX = /\{\s*([^{}=]+?)\s*=\s*(\d{17,20})\s*\}/g;

const SPACER_DATA_ATTR = "veilBannerSpacer";
const SHIFT_DATA_ATTR = "veilBannerShift";
const PREV_POSITION_ATTR = "veilPrevPosition";
const PREV_MARGIN_ATTR = "veilPrevMargin";
const PREV_TOP_ATTR = "veilPrevTop";
const PREV_Z_ATTR = "veilPrevZ";
const PREV_TRANSFORM_ATTR = "veilPrevTransform";
const ROW_SHIFT_ATTR = "veilRowShift";
const ROW_PREV_TRANSFORM_ATTR = "veilRowPrevTransform";

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

/* ------------------------------------------------------------------ */
/*  Transform / virtualization helpers                                 */
/* ------------------------------------------------------------------ */

/** Extract the translateY component (in px) from a transform string, whether
 *  it's an inline `translateY(Npx)` or a computed `matrix(a,b,c,d,tx,ty)`. */
function parseTranslateY(transform: string | null | undefined): number {
    if (!transform || transform === "none") return 0;
    const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
    if (matrixMatch) {
        const parts = matrixMatch[1].split(",").map(s => parseFloat(s.trim()));
        return parts[5] ?? 0;
    }
    const translateMatch = transform.match(/translateY?\(\s*(-?[\d.]+)px/);
    if (translateMatch) return parseFloat(translateMatch[1]);
    return 0;
}

/** Rewrite (or append) the translateY component of a transform string. */
function withTranslateY(transform: string | null | undefined, newY: number): string {
    if (!transform || transform === "none") return `translateY(${newY}px)`;
    if (/translateY?\(/.test(transform)) {
        return transform.replace(/translateY?\(\s*-?[\d.]+px\s*\)/, `translateY(${newY}px)`);
    }
    return `${transform} translateY(${newY}px)`;
}

/** Walk up from the header button to find the nearest ancestor that is
 *  itself positioned via an inline transform – this is the actual
 *  virtualized "row" element in Discord's channel list, which is often a
 *  few levels above the clickable header div. Returns null if the list
 *  isn't transform-virtualized (older/alternate Discord builds). */
function findTransformRow(el: HTMLElement): HTMLElement | null {
    let cur: HTMLElement | null = el;
    for (let i = 0; i < 6 && cur; i++) {
        if (cur.style.transform && cur.style.transform !== "none") return cur;
        cur = cur.parentElement;
    }
    return null;
}

/** Shift every sibling row at or below `row`'s current offset down by
 *  `height` px, so the banner has real space instead of overlapping the
 *  next row. Original transforms are stashed on the row itself so
 *  clearBanners() can restore them exactly. */
function shiftRowsBelow(row: HTMLElement, height: number) {
    const container = row.parentElement;
    if (!container) return;

    const rowTy = parseTranslateY(row.style.transform);
    const siblings = Array.from(container.children) as HTMLElement[];

    siblings.forEach(sib => {
        if (sib.classList.contains(BANNER_CLASS)) return;
        if (!sib.style.transform) return;

        const currentTy = parseTranslateY(sib.style.transform);
        if (currentTy < rowTy) return; // row is above the insertion point, leave it

        if (!sib.dataset[ROW_SHIFT_ATTR]) {
            sib.dataset[ROW_PREV_TRANSFORM_ATTR] = sib.style.transform;
            sib.dataset[ROW_SHIFT_ATTR] = "1";
        }
        const baseTy = parseTranslateY(sib.dataset[ROW_PREV_TRANSFORM_ATTR]);
        sib.style.transform = withTranslateY(sib.style.transform, baseTy + height);
    });
}

/* ------------------------------------------------------------------ */
/*  Banner injection / cleanup                                         */
/* ------------------------------------------------------------------ */

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
        delete e.dataset[SHIFT_DATA_ATTR];
        delete e.dataset[PREV_POSITION_ATTR];
        delete e.dataset[PREV_MARGIN_ATTR];
        delete e.dataset[PREV_TOP_ATTR];
        delete e.dataset[PREV_Z_ATTR];
        delete e.dataset[PREV_TRANSFORM_ATTR];
    });

    document.querySelectorAll(`[data-${ROW_SHIFT_ATTR}]`).forEach((el: Element) => {
        const e = el as HTMLElement;
        e.style.transform = e.dataset[ROW_PREV_TRANSFORM_ATTR] ?? "";
        delete e.dataset[ROW_SHIFT_ATTR];
        delete e.dataset[ROW_PREV_TRANSFORM_ATTR];
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

        const previous = btn.previousElementSibling;
        if (previous?.classList?.contains(BANNER_CLASS)) return;

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

            // Prefer the transform-virtualized row wrapper if one exists —
            // this is what's actually responsible for the row's on-screen
            // position in modern Discord's channel list.
            const row = findTransformRow(btn);

            if (row) {
                btn.dataset[SHIFT_DATA_ATTR] = String(height);
                shiftRowsBelow(row, height);
                return;
            }

            // Fallback: older/non-virtualized layouts where the header
            // participates in normal flow or is absolutely positioned.
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

        btn.parentElement?.insertBefore(banner, btn);

        if (banner.complete && banner.naturalHeight !== 0) {
            applyShift();
        } else {
            banner.addEventListener("load", applyShift, { once: true });
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
