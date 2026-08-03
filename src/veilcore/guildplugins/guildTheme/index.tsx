import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore, ChannelStore } from "@webpack/common";

const STYLE_ID = "veil-guild-theme";
const CSS_CHANNEL_NAME = "css";

let watchedGuildId: string | null = null;

function getCssForGuild(guildId: string): string | null {
    const channels = ChannelStore.getMutableGuildChannelsForGuild(guildId);
    const cssChannel = Object.values(channels).find(
        (c: any) => c.name?.toLowerCase() === CSS_CHANNEL_NAME
    ) as any;

    // topic caps out around 1024 chars on most Discord tiers — fine for
    // small overrides, but don't expect a full stylesheet to fit. Worth
    // switching to a pinned message or an attachment if you outgrow it.
    return cssChannel?.topic || null;
}

function applyThemeIfActive() {
    const selected = SelectedGuildStore.getGuildId();
    const css = selected && selected === watchedGuildId ? getCssForGuild(selected) : null;

    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

    if (css) {
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = css;
    } else {
        styleEl?.remove();
    }
}

function onChannelUpdate({ channel }: any) {
    // live-refresh if the owner edits #css topic while you're actively
    // sitting in that guild — same pattern as the veil-plugins channel
    if (channel?.guild_id === watchedGuildId && channel?.name?.toLowerCase() === CSS_CHANNEL_NAME) {
        applyThemeIfActive();
    }
}

export default defineGuildPlugin({
    name: "GuildTheme",
    description: "Applies CSS from this guild's #css channel topic while you're viewing it, reverts the moment you switch away.",
    authors: [VeilDevs.Zarak],

    start(guildId?: string) {
        watchedGuildId = guildId ?? null;
        FluxDispatcher.subscribe("CHANNEL_SELECT", applyThemeIfActive);
        FluxDispatcher.subscribe("CHANNEL_UPDATE", onChannelUpdate);
        applyThemeIfActive(); // in case you're already sitting in the guild when it activates
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", applyThemeIfActive);
        FluxDispatcher.unsubscribe("CHANNEL_UPDATE", onChannelUpdate);
        document.getElementById(STYLE_ID)?.remove();
        watchedGuildId = null;
    },
});
