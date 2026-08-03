import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, SelectedGuildStore } from "@webpack/common";

const STYLE_ID = "veil-guild-theme";

// Per-guild CSS overrides. Swap/extend the variables here to whatever you
// want a themed server to change — accent color, background, etc.
// (Later you could pull this from the guild's manifest entry instead of
// hardcoding it, so each server owner can define their own theme.)
const GUILD_THEMES: Record<string, string> = {
    // "123456789012345678": `:root { --background-primary: #1a0000; --brand-experiment: #b30000; }`,
};

let watchedGuildId: string | null = null;

function applyThemeIfActive() {
    const selected = SelectedGuildStore.getGuildId();
    const theme = selected && selected === watchedGuildId ? GUILD_THEMES[selected] : null;

    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;

    if (theme) {
        if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = STYLE_ID;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = theme;
    } else {
        styleEl?.remove();
    }
}

export default defineGuildPlugin({
    name: "GuildTheme",
    description: "Applies this guild's custom theme while you're viewing it, reverts the moment you switch away.",
    authors: [VeilDevs.Zarak],

    // guildId is threaded in by guildPluginManager.activate() — see the
    // manager change below.
    start(guildId?: string) {
        watchedGuildId = guildId ?? null;
        FluxDispatcher.subscribe("CHANNEL_SELECT", applyThemeIfActive);
        applyThemeIfActive(); // in case you're already sitting in the guild when it activates
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", applyThemeIfActive);
        document.getElementById(STYLE_ID)?.remove();
        watchedGuildId = null;
    },
});
