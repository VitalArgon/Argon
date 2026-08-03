import { GuildManifest, GuildManifestEntry } from "@veilcore/guildplugins/manifest";

const REMOTE_MANIFEST_URL: string | null = null; // set later if you want live toggling

let cached: GuildManifestEntry[] = GuildManifest;

export async function loadManifest(): Promise<GuildManifestEntry[]> {
    if (!REMOTE_MANIFEST_URL) return GuildManifest;

    try {
        const res = await fetch(REMOTE_MANIFEST_URL);
        if (!res.ok) throw new Error(`status ${res.status}`);
        cached = await res.json();
    } catch (e) {
        console.warn("[Veil] remote guild manifest fetch failed, using bundled manifest", e);
        cached = GuildManifest;
    }
    return cached;
}

export function getCachedManifest(): GuildManifestEntry[] {
    return cached;
}

export function getEntryForGuild(guildId: string): GuildManifestEntry | undefined {
    return cached.find(e => e.guildId === guildId);
}
