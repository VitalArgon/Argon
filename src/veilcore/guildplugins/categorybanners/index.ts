import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore, ChannelStore, RestAPI } from "@webpack/common";

const BANNER_CHANNEL_NAME = "categorybanners";
const BANNER_CLASS = "veil-category-banner";
// {categoryname = messageid} — name can be anything but = and { }
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

async function fetchRecentMessages(channelId: string) {
    // grabs the most recent 100 — the mapping message and the image message
    // both need to land inside this window, so don't bury old banner posts
    const res = await RestAPI.get({
        url: `/channels/${channelId}/messages`,
        query: { limit: 100 },
    });
    return res.body as any[];
}

async function rebuildBannerMap(guildId: string) {
    const channel = findBannerChannel(guildId);
    if (!channel) {
        bannerMap = new Map();
        return;
    }

    const messages = await fetchRecentMessages(channel.id);
    const byId = new Map(messages.map((m: any) => [m.id, m]));

    const newMap = new Map<string, string>();
    for (const msg of messages) {
        for (const match of msg.content.matchAll(MAPPING_REGEX)) {
            const [, rawName, msgId] = match;
            const target = byId.get(msgId);
            const url = target?.attachments?.[0]?.url;
            if (url) newMap.set(rawName.trim().toLowerCase(), url);
        }
    }
    bannerMap = newMap;
}

function clearBanners() {
    document.querySelectorAll(`.${BANNER_CLASS}`).forEach(el => el.remove());
}

function injectBanners() {
    if (!bannerMap.size) return;
    // category headers render as role="button" rows whose visible text is
    // the category name — reselect this if Discord shuffles sidebar classes
    const headers = document.querySelectorAll('[role="button"] [class*="title-"]');
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
    if (channel?.guild_id === watchedGuildId && channel?.name?.toLowerCase() === BANNER_CHANNEL_NAME) {
        applyIfActive();
    }
}

function onMessageEvent({ message, channelId }: any) {
    const channel = ChannelStore.getChannel(channelId ?? message?.channel_id);
    if (channel?.guild_id === watchedGuildId && channel?.name?.toLowerCase() === BANNER_CHANNEL_NAME) {
        applyIfActive();
    }
}

export default defineGuildPlugin({
    name: "CategoryBanners",
    description: "Displays a banner image above each category, sourced from #categorybanners entries formatted as {categoryname = messageid}.",
    authors: [VeilDevs.Zarak],
    start(guildId?: string) {
        watchedGuildId = guildId ?? null;

        FluxDispatcher.subscribe("CHANNEL_SELECT", applyIfActive);
        FluxDispatcher.subscribe("GUILD_SELECT", applyIfActive);
        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageEvent);
        FluxDispatcher.subscribe("MESSAGE_UPDATE", onMessageEvent);
        FluxDispatcher.subscribe("MESSAGE_DELETE", onMessageEvent);

        observer = new MutationObserver(() => injectBanners());
        const root = document.querySelector('[class*="sidebar-"]');
        if (root) observer.observe(root, { childList: true, subtree: true });

        applyIfActive();
    },
    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", applyIfActive);
        FluxDispatcher.unsubscribe("GUILD_SELECT", applyIfActive);
        FluxDispatcher.unsubscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageEvent);
        FluxDispatcher.unsubscribe("MESSAGE_UPDATE", onMessageEvent);
        FluxDispatcher.unsubscribe("MESSAGE_DELETE", onMessageEvent);
        observer?.disconnect();
        observer = null;
        clearBanners();
        bannerMap = new Map();
        watchedGuildId = null;
    },
});
