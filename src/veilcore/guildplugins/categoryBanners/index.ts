import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore, ChannelStore, RestAPI } from "@webpack/common";

console.log("[CategoryBanners] module loaded");

const BANNER_CHANNEL_NAME = "categorybanners";
const BANNER_CLASS = "veil-category-banner";
// {categoryname = messageid} — read from the channel topic, same as #css
const MAPPING_REGEX = /\{\s*([^{}=]+?)\s*=\s*(\d{17,20})\s*\}/g;

let watchedGuildId: string | null = null;
let bannerMap: Map<string, string> = new Map(); // category name (normalized) or category id -> image url
let observer: MutationObserver | null = null;

function findBannerChannel(guildId: string) {
    const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
    return Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === BANNER_CHANNEL_NAME
    ) as any;
}

function normalizeName(raw?: string) {
    if (!raw) return "";
    const lower = raw.trim().toLowerCase();
    try {
        // Try Unicode-safe normalization (may throw in older engines)
        return lower.replace(/[^^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, " ").trim();
    } catch (e) {
        // Fallback to ASCII-only sanitization
        return lower.replace(/[^a-z0-9\s_-]/g, "").replace(/\s+/g, " ").trim();
    }
}

function parseMappingsFromTopic(topic: string | null | undefined) {
    const mappings: { name: string; msgId: string }[] = [];
    if (!topic) return mappings;
    for (const match of topic.matchAll(MAPPING_REGEX)) {
        const [, rawName, msgId] = match;
        mappings.push({ name: normalizeName(rawName), msgId });
    }
    return mappings;
}

async function fetchMessage(channelId: string, messageId: string) {
    // single-message fetch — no reason to page through history for this
    const res = await RestAPI.get({
        url: `/channels/${channelId}/messages`,
        query: { limit: 1, around: messageId },
    });
    const msgs = res.body as any[];
    return msgs.find(m => m.id === messageId) ?? null;
}

async function rebuildBannerMap(guildId: string) {
    const channel = findBannerChannel(guildId);
    console.log("[CategoryBanners] channel:", channel?.id, channel?.topic);
    if (!channel) {
        bannerMap = new Map();
        return;
    }

    const mappings = parseMappingsFromTopic(channel.topic);
    console.log("[CategoryBanners] mappings:", mappings);
    const newMap = new Map<string, string>();

    // grab guild channels once for name -> id resolution
    const guildChannels = ChannelStore.getMutableGuildChannelsForGuild(guildId) || {};

    await Promise.all(mappings.map(async ({ name, msgId }) => {
        const msg = await fetchMessage(channel.id, msgId);
        console.log("[CategoryBanners] fetched msg:", msgId, msg);
        const url = msg?.attachments?.[0]?.url;
        console.log("[CategoryBanners] attachment url:", url);
        if (!url) return;

        // store by the given key (normalized name or numeric id string)
        newMap.set(name, url);

        // if the mapping was a textual name, attempt to find the category channel and also store by its id
        const isId = /^\d{17,20}$/.test(name);
        if (!isId) {
            const matched = Object.values(guildChannels).find((c: any) => c.type === 4 && normalizeName(c.name) === name);
            if (matched) {
                newMap.set(matched.id, url);
            }
        } else {
            // if the mapping was a numeric id, ensure we also set by that id (redundant but explicit)
            newMap.set(name, url);
        }
    }));

    bannerMap = newMap;
    console.log("[CategoryBanners] final map:", newMap);
}

function clearBanners() {
    document.querySelectorAll(`.${BANNER_CLASS}`).forEach(el => el.remove());
}

function injectBanners() {
    if (!bannerMap.size) return;

    const guildId = SelectedGuildStore.getGuildId();
    const guildChannels = guildId ? ChannelStore.getMutableGuildChannelsForGuild(guildId) : {};

    // Prefer collapsible category buttons — they usually have aria-expanded
    const buttons = Array.from(document.querySelectorAll('[role="button"][aria-expanded]')) as HTMLElement[];
    if (!buttons.length) return;

    console.log("[CategoryBanners] category buttons found:", buttons.length);

    buttons.forEach(btn => {
        // Prefer a title element when present, otherwise fall back to the button's text
        const titleEl = btn.querySelector('[class*="title-"]') as HTMLElement | null;
        const rawName = (titleEl?.textContent ?? btn.textContent) || "";
        const name = normalizeName(rawName);
        if (!name) return;

        const headerRow = btn; // the button is the header row
        if (!headerRow) return;

        // Avoid inserting duplicates — look for an existing banner immediately above this header within the same parent
        const prev = headerRow.previousElementSibling;
        if (prev?.classList?.contains(BANNER_CLASS)) return;
        // also if the parent already contains a banner for this header, skip
        if (headerRow.parentElement?.querySelector(`.${BANNER_CLASS}`)) return;

        // try to resolve a category channel by name to get its id (if any)
        const categoryChannel = Object.values(guildChannels).find((c: any) => c.type === 4 && normalizeName(c.name) === name);
        const idKey = categoryChannel?.id;

        // prefer ID-based mapping if available, fall back to name-based mapping
        const url = (idKey && bannerMap.get(idKey)) ?? bannerMap.get(name);
        if (!url) return;

        const banner = document.createElement("img");
        banner.src = url;
        banner.className = BANNER_CLASS;
        banner.style.cssText = "width:100%;border-radius:4px;margin:4px 0;display:block;";

        // Insert the banner directly before the header button so it appears above the category title
        headerRow.parentElement?.insertBefore(banner, headerRow);
    });
}

function refresh() {
    clearBanners();
    injectBanners();
}

async function applyIfActive() {
    const selected = SelectedGuildStore.getGuildId();
    console.log("[CategoryBanners] applyIfActive — selected:", selected, "watched:", watchedGuildId);
    if (selected && selected === watchedGuildId) {
        await rebuildBannerMap(selected);
        refresh();
    } else {
        clearBanners();
    }
}

function onChannelUpdate({ channel }: any) {
    // topic edits are what matter now, not new messages in the channel
    if (channel?.guild_id === watchedGuildId && channel?.name?.toLowerCase() === BANNER_CHANNEL_NAME) {
        applyIfActive();
    }
}

export default defineGuildPlugin({
    name: "CategoryBanners",
    description: "Displays a banner image above each category, sourced from #categorybanners' topic formatted as {categoryname = messageid}.",
    authors: [VeilDevs.Zarak],
    start(guildId?: string) {
        console.log("[CategoryBanners] start() called with guildId:", guildId);
        watchedGuildId = guildId ?? null;

        FluxDispatcher.subscribe("CHANNEL_SELECT", applyIfActive);
        FluxDispatcher.subscribe("GUILD_SELECT", applyIfActive);
        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);

        observer = new MutationObserver(() => injectBanners());
        const root = document.querySelector('[class*="sidebar-"]');
        console.log("[CategoryBanners] sidebar root found:", !!root);
        if (root) observer.observe(root, { childList: true, subtree: true });

        applyIfActive();
    },
    stop() {
        console.log("[CategoryBanners] stop() called");
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
