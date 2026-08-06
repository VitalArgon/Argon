import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore, ChannelStore, RestAPI } from "@webpack/common";

const BANNER_CHANNEL_NAME = "categorybanners";
const BANNER_CLASS = "veil-category-banner";
// {categoryname = messageid} — read from the channel topic, same as #css
const MAPPING_REGEX = /\{\s*([^{}=]+?)\s*=\s*(\d{17,20})\s*\}/g;

let watchedGuildId: string | null = null;
let bannerMap: Map<string, string> = new Map(); // category name (lowercase) -> image url
let observer: MutationObserver | null = null;

function findBannerChannel(guildId: string) {
    const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
    return Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === BANNER_CHANNEL_NAME
    ) as any;
}

function parseMappingsFromTopic(topic: string | null | undefined) {
    const mappings: { name: string; msgId: string }[] = [];
    if (!topic) return mappings;
    for (const match of topic.matchAll(MAPPING_REGEX)) {
        const [, rawName, msgId] = match;
        mappings.push({ name: rawName.trim().toLowerCase(), msgId });
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

    await Promise.all(mappings.map(async ({ name, msgId }) => {
        const msg = await fetchMessage(channel.id, msgId);
        console.log("[CategoryBanners] fetched msg:", msgId, msg);
        const url = msg?.attachments?.[0]?.url;
        console.log("[CategoryBanners] attachment url:", url);
        if (url) newMap.set(name, url);
    }));

    bannerMap = newMap;
    console.log("[CategoryBanners] final map:", newMap);
}

function clearBanners() {
    document.querySelectorAll(`.${BANNER_CLASS}`).forEach(el => el.remove());
}

function injectBanners() {
    if (!bannerMap.size) return;
    const headers = document.querySelectorAll('[role="button"] [class*="title-"]');
    console.log("[CategoryBanners] headers found:", headers.length, [...headers].map(h => h.textContent));
    headers.forEach(titleEl => {
        const name = titleEl.textContent?.trim().toLowerCase();
        if (!name || !bannerMap.has(name)) return;

        const headerRow = titleEl.closest('[role="button"]') as HTMLElement | null;
        if (!headerRow) return;
        if (headerRow.previousElementSibling?.classList.contains(BANNER_CLASS)) return;

        const banner = document.createElement("img");
        banner.src = bannerMap.get(name)!;
        banner.className = BANNER_CLASS;
        banner.style.cssText = "width:100%;border-radius:4px;margin:4px 0;display:block;";
        headerRow.parentElement?.insertBefore(banner, headerRow);
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
