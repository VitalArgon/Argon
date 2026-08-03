import { getEntryForGuild } from "./manifestSource";
import { openGuildPluginsPanel } from "./guildPluginsPanel"; // your own panel/modal

// Confirm this against the real DOM — right-click "Channels & Roles" ->
// Inspect -> walk up to the row's shared parent list.
const QUICK_ACCESS_LIST_SELECTOR = 'div[class*="quickAccess__"]';
const ROW_ID = "veil-guild-plugins-row";

function currentGuildId(): string | null {
    // Discord's routes look like /channels/<guildId>/<channelId>,
    // with "@me" in place of a guild id for DMs — filter that out.
    const match = window.location.pathname.match(/^\/channels\/([^/]+)/);
    if (!match) return null;
    const guildId = match[1];
    return guildId === "@me" ? null : guildId;
}

function injectRow(root: ParentNode) {
    const guildId = currentGuildId();
    if (!guildId) return;

    const entry = getEntryForGuild(guildId);
    const list = root.querySelector(QUICK_ACCESS_LIST_SELECTOR);
    if (!list) return;

    const existing = list.querySelector(`#${ROW_ID}`);
    if (!entry) {
        existing?.remove(); // no row at all if this guild has nothing unlocked
        return;
    }
    if (existing) return;

    const row = document.createElement("div");
    row.id = ROW_ID;
    row.textContent = "Guild Plugins";
    row.style.cursor = "pointer";
    row.addEventListener("click", () => openGuildPluginsPanel(entry));
    list.appendChild(row);
}

let observer: MutationObserver | null = null;

export function startGuildPluginsSidebarRow() {
    injectRow(document);
    observer = new MutationObserver(() => injectRow(document));
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopGuildPluginsSidebarRow() {
    observer?.disconnect();
    observer = null;
    document.getElementById(ROW_ID)?.remove();
}
