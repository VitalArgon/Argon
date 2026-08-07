import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { ChannelStore, FluxDispatcher } from "@webpack/common";

const NAMES_CHANNEL_NAME = "customnames";
// {shorthand = replacement} — value can contain spaces/symbols, just not { or }
const MAPPING_REGEX = /\{\s*([^{}=]+?)\s*=\s*([^{}]+?)\s*\}/g;

// dash-to-space is structural (Discord channel names can't contain literal
// spaces), so it always applies regardless of what's defined in the topic
const BASE_REPLACEMENTS: [RegExp, string][] = [
    [/-/g, " "],
];

let watchedGuildId: string | null = null;
let dynamicReplacements: [RegExp, string][] = [];

let originalGetChannel: typeof ChannelStore.getChannel | null = null;
let originalGetMutableGuildChannelsForGuild: typeof ChannelStore.getMutableGuildChannelsForGuild | null = null;

function escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseReplacementsFromTopic(topic: string | null | undefined): [RegExp, string][] {
    const pairs: [RegExp, string][] = [];
    if (!topic) return pairs;
    for (const match of topic.matchAll(MAPPING_REGEX)) {
        const [, shorthand, replacement] = match;
        pairs.push([new RegExp(escapeRegex(shorthand.trim()), "g"), replacement]);
    }
    return pairs;
}

function applyReplacements(text: string) {
    let out = text;
    for (const [pattern, replacement] of BASE_REPLACEMENTS) out = out.replace(pattern, replacement);
    for (const [pattern, replacement] of dynamicReplacements) out = out.replace(pattern, replacement);
    return out;
}

function rebuildReplacements(guildId: string) {
    if (!originalGetMutableGuildChannelsForGuild) return;
    const channels = originalGetMutableGuildChannelsForGuild.call(ChannelStore, guildId);
    const namesChannel = Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === NAMES_CHANNEL_NAME
    ) as any;
    dynamicReplacements = parseReplacementsFromTopic(namesChannel?.topic);
}

function withDisplayName(channel: any) {
    if (!channel || channel.guild_id !== watchedGuildId || typeof channel.name !== "string") return channel;
    // Avoid modifying the special names channel so we can still read its topic
    if (channel.name.toLowerCase() === NAMES_CHANNEL_NAME) return channel;

    const displayName = applyReplacements(channel.name);
    return displayName === channel.name ? channel : { ...channel, name: displayName };
}

// Mutate in-store channel objects where possible so components holding references
// to the original objects see our display names immediately.
function applyDisplayNamesToGuildChannels(guildId: string) {
    if (!originalGetMutableGuildChannelsForGuild) return;
    const channels = originalGetMutableGuildChannelsForGuild.call(ChannelStore, guildId);
    for (const ch of Object.values(channels) as any[]) {
        if (!ch || ch.guild_id !== watchedGuildId || typeof ch.name !== "string") continue;
        if (ch.name.toLowerCase() === NAMES_CHANNEL_NAME) continue;
        const displayName = applyReplacements(ch.name);
        if (displayName !== ch.name) {
            try {
                ch.name = displayName;
            } catch (e) {
                // ignore — fall back to getter patching which returns copies
            }
        }
    }
}

// Handle channel select events (e.g., when the user clicks a channel)
// and attempt to mutate the selected channel object in-place.
function onChannelSelect({ channelId, guildId }: any) {
    if (!channelId || !guildId || guildId !== watchedGuildId) return;
    if (!originalGetChannel) return;
    const channel = originalGetChannel.call(ChannelStore, channelId);
    if (!channel || typeof channel.name !== "string") return;
    if (channel.name.toLowerCase() === NAMES_CHANNEL_NAME) return;
    const displayName = applyReplacements(channel.name);
    if (displayName !== channel.name) {
        try { channel.name = displayName; } catch (e) { /* ignore */ }
    }
}

function onChannelUpdate({ channel }: any) {
    if (!channel || channel.guild_id !== watchedGuildId || typeof channel.name !== "string") return;

    // If the special names channel changed, rebuild our replacement list
    if (channel.name.toLowerCase() === NAMES_CHANNEL_NAME) {
        rebuildReplacements(watchedGuildId!);
        // Also re-apply display names across the guild
        applyDisplayNamesToGuildChannels(watchedGuildId!);
        return;
    }

    // Mutate the dispatched channel object so subscribers that use the event payload
    // (instead of calling ChannelStore.getChannel) also see the display name.
    const displayName = applyReplacements(channel.name);
    if (displayName !== channel.name) {
        try { channel.name = displayName; } catch (e) { /* ignore */ }
    }
}

export default defineGuildPlugin({
    name: "CustomChannelNames",
    description: "Renders custom shorthand substitutions in this guild's channel names via a ChannelStore patch, defined in #customnames' topic as {shorthand = replacement} (display-only, cosmetic).",
    authors: [VeilDevs.Zarak],
    start(guildId?: string) {
        watchedGuildId = guildId ?? null;

        originalGetChannel = ChannelStore.getChannel.bind(ChannelStore);
        originalGetMutableGuildChannelsForGuild = ChannelStore.getMutableGuildChannelsForGuild.bind(ChannelStore);

        if (watchedGuildId) rebuildReplacements(watchedGuildId);

        // Patch the getters themselves rather than the DOM — every component
        // (sidebar item, chat header, textarea placeholder) reads channel.name
        // through these same Flux store calls, so React re-renders it for us.
        // @ts-ignore — intentional override, restored in stop()
        ChannelStore.getChannel = (channelId: string) => withDisplayName(originalGetChannel!(channelId));

        // @ts-ignore — intentional override, restored in stop()
        ChannelStore.getMutableGuildChannelsForGuild = (guildId: string) => {
            const channels = originalGetMutableGuildChannelsForGuild!.call(ChannelStore, guildId);
            if (guildId !== watchedGuildId) return channels;
            const patched: Record<string, any> = {};
            for (const [id, channel] of Object.entries(channels)) {
                patched[id] = withDisplayName(channel);
            }
            return patched;
        };

        // Apply display names into store objects right away to cover components
        // that keep references to existing objects.
        if (watchedGuildId) applyDisplayNamesToGuildChannels(watchedGuildId);

        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
    },
    stop() {
        if (originalGetChannel) ChannelStore.getChannel = originalGetChannel;
        if (originalGetMutableGuildChannelsForGuild) {
            ChannelStore.getMutableGuildChannelsForGuild = originalGetMutableGuildChannelsForGuild;
        }
        originalGetChannel = null;
        originalGetMutableGuildChannelsForGuild = null;

        FluxDispatcher.unsubscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        dynamicReplacements = [];
        watchedGuildId = null;
    },
});
