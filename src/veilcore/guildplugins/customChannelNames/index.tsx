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

// How often to auto-step the cycle (ms).
const DEFAULT_DELAY_MS = 2000;
// Safety cap on the number of iterations (will wrap back to 0 to loop).
const MAX_ITERATIONS = 300;

let watchedGuildId: string | null = null;
let dynamicReplacements: [RegExp, string][] = [];

// Map of channelId -> original server-provided name (never mutated)
const originalChannelNames: Map<string, string> = new Map();
// Map of channelId -> how many times to apply the replacements (iteration index)
const iterationCounts: Map<string, number> = new Map();

let intervalHandle: ReturnType<typeof setInterval> | null = null;

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

// Apply the full replacement set once (base + dynamic)
function applyOnce(text: string) {
    let out = text;
    for (const [pattern, replacement] of BASE_REPLACEMENTS) out = out.replace(pattern, replacement);
    for (const [pattern, replacement] of dynamicReplacements) out = out.replace(pattern, replacement);
    return out;
}

// Apply replacement set repeatedly 'times' times (stops early if stable)
function applyRepeated(text: string, times: number) {
    let out = text;
    for (let i = 0; i < times; i++) {
        const next = applyOnce(out);
        if (next === out) break;
        out = next;
    }
    return out;
}

// Helper: get the original/source name for a channel (prefer saved original,
// fallback to the current channel.name).
function getSourceNameForChannel(channelId: string, channelObj?: any) {
    if (originalChannelNames.has(channelId)) return originalChannelNames.get(channelId)!;
    if (channelObj && typeof channelObj.name === "string") return channelObj.name;
    return "";
}

function rebuildReplacements(guildId: string) {
    if (!originalGetMutableGuildChannelsForGuild) return;
    const channels = originalGetMutableGuildChannelsForGuild.call(ChannelStore, guildId);
    const namesChannel = Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === NAMES_CHANNEL_NAME
    ) as any;
    dynamicReplacements = parseReplacementsFromTopic(namesChannel?.topic);
}

// Build the final display name by applying the mapping repeatedly per-channel
function buildDisplayName(originalName: string, channelId: string) {
    const count = iterationCounts.get(channelId) || 0;
    return applyRepeated(originalName, count);
}

function withDisplayName(channel: any) {
    if (!channel || channel.guild_id !== watchedGuildId || typeof channel.name !== "string") return channel;
    // Avoid modifying the special names channel so we can still read its topic
    if (channel.name.toLowerCase() === NAMES_CHANNEL_NAME) return channel;

    // Ensure we have a stable original source for this channel
    if (channel.id && !originalChannelNames.has(channel.id)) originalChannelNames.set(channel.id, channel.name);
    const sourceName = getSourceNameForChannel(channel.id, channel);
    const displayName = buildDisplayName(sourceName, channel.id);
    return displayName === channel.name ? channel : { ...channel, name: displayName };
}

// Mutate in-store channel objects where possible so components holding references
// to the original objects see our display names immediately.
function applyDisplayNamesToGuildChannels(guildId: string) {
    if (!originalGetMutableGuildChannelsForGuild) return;
    const channels = originalGetMutableGuildChannelsForGuild.call(ChannelStore, guildId);
    for (const [id, ch] of Object.entries(channels) as [string, any][]) {
        if (!ch || ch.guild_id !== watchedGuildId || typeof ch.name !== "string") continue;
        if (ch.name.toLowerCase() === NAMES_CHANNEL_NAME) continue;

        // Save the original name if not already saved.
        if (!originalChannelNames.has(id)) {
            originalChannelNames.set(id, ch.name);
        }
        const sourceName = originalChannelNames.get(id)!;
        const displayName = buildDisplayName(sourceName, id);
        if (displayName !== ch.name) {
            try {
                ch.name = displayName;
            } catch (e) {
                // ignore — fall back to getter patching which returns copies
            }
        }
    }
}

// Only increment iteration for channels that are affected by at least one mapping
function channelIsAffectedByMappings(sourceName: string) {
    if (!dynamicReplacements.length) return false;
    for (const [pattern] of dynamicReplacements) {
        // reset lastIndex in case pattern has 'g'
        try { pattern.lastIndex = 0; } catch { /* ignore */ }
        if (pattern.test(sourceName)) return true;
    }
    return false;
}

function incrementIterationForChannel(channelId: string) {
    const now = iterationCounts.get(channelId) || 0;
    const next = (now + 1) % (MAX_ITERATIONS + 1); // wrap to create a loop
    iterationCounts.set(channelId, next);
    // Apply immediately if we have channel object access
    if (originalGetChannel) {
        const ch = originalGetChannel.call(ChannelStore, channelId);
        if (ch && ch.guild_id === watchedGuildId && typeof ch.name === "string" && ch.name.toLowerCase() !== NAMES_CHANNEL_NAME) {
            try { ch.name = buildDisplayName(getSourceNameForChannel(channelId, ch), channelId); } catch (e) { /* ignore */ }
        }
    }
}

// Handle channel select events (e.g., when the user clicks a channel)
// and step that channel through the cycle.
function onChannelSelect({ channelId, guildId }: any) {
    if (!channelId || !guildId || guildId !== watchedGuildId) return;
    if (!originalGetChannel) return;
    const channel = originalGetChannel.call(ChannelStore, channelId);
    if (!channel || typeof channel.name !== "string") return;
    if (channel.name.toLowerCase() === NAMES_CHANNEL_NAME) return;

    // Ensure original name is saved.
    if (!originalChannelNames.has(channelId)) originalChannelNames.set(channelId, channel.name);
    const sourceName = getSourceNameForChannel(channelId, channel);
    if (channelIsAffectedByMappings(sourceName)) incrementIterationForChannel(channelId);
}

function onChannelUpdate({ channel }: any) {
    if (!channel || channel.guild_id !== watchedGuildId || typeof channel.name !== "string") return;

    // If the special names channel changed, rebuild our replacement list
    if (channel.name.toLowerCase() === NAMES_CHANNEL_NAME) {
        // Update original map for the names channel too (so its topic reading is consistent)
        if (channel.id) originalChannelNames.set(channel.id, channel.name);
        rebuildReplacements(watchedGuildId!);
        // Also re-apply display names across the guild
        applyDisplayNamesToGuildChannels(watchedGuildId!);
        return;
    }

    // The channel payload is fresh server data — record its original name first.
    if (channel.id) originalChannelNames.set(channel.id, channel.name);

    // Mutate the dispatched channel object so subscribers that use the event payload
    // (instead of calling ChannelStore.getChannel) also see the display name.
    const sourceName = getSourceNameForChannel(channel.id, channel);
    const displayName = buildDisplayName(sourceName, channel.id);
    if (displayName !== channel.name) {
        try { channel.name = displayName; } catch (e) { /* ignore */ }
    }
}

export default defineGuildPlugin({
    name: "CustomChannelNames",
    description: "Renders custom shorthand substitutions in this guild's channel names via a ChannelStore patch, defined in #customnames' topic as {shorthand = replacement} (display-only, cosmetic) and steps through mapping iterations for affected channels.",
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
                // Ensure original name saved for each channel so withDisplayName has a stable source
                if (typeof channel?.name === "string" && !originalChannelNames.has(id)) {
                    originalChannelNames.set(id, channel.name);
                }
                patched[id] = withDisplayName(channel);
            }
            return patched;
        };

        // Apply display names into store objects right away to cover components
        // that keep references to existing objects.
        if (watchedGuildId) applyDisplayNamesToGuildChannels(watchedGuildId);

        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);

        // Start periodic stepping for affected channels in the watched guild.
        if (watchedGuildId) {
            intervalHandle = setInterval(() => {
                try {
                    if (!originalGetMutableGuildChannelsForGuild) return;
                    const channels = originalGetMutableGuildChannelsForGuild.call(ChannelStore, watchedGuildId!);
                    for (const [id, ch] of Object.entries(channels) as [string, any][]) {
                        if (!ch || ch.guild_id !== watchedGuildId || typeof ch.name !== "string") continue;
                        if (ch.name.toLowerCase() === NAMES_CHANNEL_NAME) continue;
                        // Ensure original exists
                        if (!originalChannelNames.has(id)) originalChannelNames.set(id, ch.name);
                        const source = getSourceNameForChannel(id, ch);
                        if (channelIsAffectedByMappings(source)) {
                            incrementIterationForChannel(id);
                        }
                    }
                } catch (e) {
                    // ignore interval errors
                }
            }, DEFAULT_DELAY_MS);
        }
    },
    stop() {
        // Before restoring getters, restore mutated in-store names back to original
        if (originalGetMutableGuildChannelsForGuild && watchedGuildId) {
            try {
                const channels = originalGetMutableGuildChannelsForGuild.call(ChannelStore, watchedGuildId);
                for (const [id, ch] of Object.entries(channels) as [string, any][]) {
                    if (!ch || typeof ch.name !== "string") continue;
                    if (originalChannelNames.has(id)) {
                        try { ch.name = originalChannelNames.get(id)!; } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) {
                // best-effort restore; ignore if we can't access channels
            }
        }

        if (intervalHandle) {
            clearInterval(intervalHandle);
            intervalHandle = null;
        }

        if (originalGetChannel) ChannelStore.getChannel = originalGetChannel;
        if (originalGetMutableGuildChannelsForGuild) {
            ChannelStore.getMutableGuildChannelsForGuild = originalGetMutableGuildChannelsForGuild;
        }
        originalGetChannel = null;
        originalGetMutableGuildChannelsForGuild = null;

        FluxDispatcher.unsubscribe("CHANNEL_UPDATE", onChannelUpdate);
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        dynamicReplacements = [];
        originalChannelNames.clear();
        iterationCounts.clear();
        watchedGuildId = null;
    },
});
