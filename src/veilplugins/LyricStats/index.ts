import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { FluxDispatcher } from "@webpack/common";
import { VeilDevs } from "@utils/constants";
import { Activity } from "@vencord/discord-types";

export const settings = definePluginSettings({
    lyricsPrefix: {
        type: OptionType.STRING,
        description: "Text prepended to the lyric line (e.g. '🎶 ')",
        default: "🎶 ",
    },
    targetField: {
        type: OptionType.SELECT,
        description: "Which field of your Spotify activity gets replaced with the current lyric line",
        options: [
            { label: "State (usually artist name)", value: "state", default: true },
            { label: "Details (usually track name)", value: "details" },
        ],
    },
    syncInterval: {
        type: OptionType.NUMBER,
        description: "How often to recompute the active lyric line (in ms)",
        default: 150,
    },
    showConsoleLogs: {
        type: OptionType.BOOLEAN,
        description: "Show console logs for debugging",
        default: false,
    }
});

interface Track {
    id: string;
    name: string;
    duration: number;
    album: {
        name: string;
    };
    artists: {
        name: string;
    }[];
}

interface PlayerState {
    isPlaying: boolean;
    position: number;
    track: Track | null;
}

interface LyricLine {
    time: number;
    text: string;
}

let lastTrackId: string | null = null;
let currentLyrics: LyricLine[] = [];
let lastPlayerState: PlayerState | null = null;
let lastRawPayload: any = null;
let stateReceivedAt = 0;
let syncTimeoutId: any = null;
let isLoopRunning = false;

let currentLyricLine: string | null = null;
let previousLyricLine: string | null = null;

function getPrefixSetting(): string {
    try {
        return settings.store.lyricsPrefix ?? "🎶 ";
    } catch {
        return "🎶 ";
    }
}

function getTargetFieldSetting(): "state" | "details" {
    try {
        return settings.store.targetField ?? "state";
    } catch {
        return "state";
    }
}

function getSyncIntervalSetting(): number {
    try {
        return settings.store.syncInterval ?? 150;
    } catch {
        return 150;
    }
}

function shouldShowLogs(): boolean {
    try {
        return settings.store.showConsoleLogs ?? false;
    } catch {
        return false;
    }
}

function debugLog(message: string, ...args: any[]) {
    if (shouldShowLogs()) {
        console.log(message, ...args);
    }
}

function debugWarn(message: string, ...args: any[]) {
    if (shouldShowLogs()) {
        console.warn(message, ...args);
    }
}

function debugError(message: string, ...args: any[]) {
    if (shouldShowLogs()) {
        console.error(message, ...args);
    }
}

async function fetchLyrics(track: Track) {
    const artistName = track.artists.map(a => a.name).join(", ");
    const trackName = track.name;
    const albumName = track.album?.name || "";
    const durationSec = Math.round(track.duration / 1000);

    const exactUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artistName)}&track_name=${encodeURIComponent(trackName)}&album_name=${encodeURIComponent(albumName)}&duration=${durationSec}`;
    debugLog("[LyricStats] Fetching exact match:", artistName, "-", trackName);

    try {
        const response = await fetch(exactUrl, {
            headers: {
                "User-Agent": "VencordLyricStats (https://github.com/Vendicated/Vencord)"
            }
        });
        if (response.ok) {
            const data = await response.json();
            if (data && data.syncedLyrics) {
                debugLog("[LyricStats] Fetched synced lyrics (exact match).");
                return data.syncedLyrics;
            }
        }
    } catch (error) {
        debugWarn("[LyricStats] Exact match failed, falling back to search...", error);
    }

    const cleanTrackName = trackName.replace(/\s*\([^)]*\)/g, "").replace(/\s*\[[^\]]*\]/g, "").trim();
    const firstArtist = track.artists[0]?.name || "";
    const query = `${firstArtist} ${cleanTrackName}`;
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    debugLog(`[LyricStats] Searching lyrics for: "${query}"`);

    try {
        const response = await fetch(searchUrl, {
            headers: {
                "User-Agent": "VencordLyricStats (https://github.com/Vendicated/Vencord)"
            }
        });
        if (response.ok) {
            const results = await response.json();
            if (Array.isArray(results) && results.length > 0) {
                const match = results.find(r => r.syncedLyrics && Math.abs(r.duration - durationSec) < 15) || results.find(r => r.syncedLyrics);
                if (match) {
                    debugLog(`[LyricStats] Found lyrics in search! Match: ${match.artistName} - ${match.trackName}`);
                    return match.syncedLyrics;
                }
            }
        }
    } catch (error) {
        debugError("[LyricStats] Error searching lyrics:", error);
    }

    return null;
}

function parseLRC(lrcText: string): LyricLine[] {
    const lines: LyricLine[] = [];
    const rawLines = lrcText.split("\n");

    for (const line of rawLines) {
        const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseFloat(match[2]);
            const timeMs = (minutes * 60 + seconds) * 1000;
            const text = match[3].trim();
            lines.push({ time: timeMs, text });
        }
    }

    debugLog("[LyricStats] Parsed", lines.length, "lines of lyrics.");
    return lines.sort((a, b) => a.time - b.time);
}

function getCurrentPosition(): number {
    if (!lastPlayerState) return 0;
    if (!lastPlayerState.isPlaying) return lastPlayerState.position;
    return lastPlayerState.position + (Date.now() - stateReceivedAt);
}

function updateLyricsTick() {
    if (!isLoopRunning) return;

    try {
        if (lastPlayerState && lastPlayerState.isPlaying && currentLyrics.length > 0) {
            const currentPos = getCurrentPosition();
            let activeLine = "";

            for (let i = 0; i < currentLyrics.length; i++) {
                if (currentPos >= currentLyrics[i].time) {
                    if (i === currentLyrics.length - 1 || currentPos < currentLyrics[i + 1].time) {
                        activeLine = currentLyrics[i].text;
                        break;
                    }
                }
            }

            currentLyricLine = activeLine || null;
        } else {
            currentLyricLine = null;
        }

        if (currentLyricLine !== previousLyricLine) {
            previousLyricLine = currentLyricLine;
            pingSpotifyStore();
        }
    } catch (e) {
        debugError("[LyricStats] Error in updateLyricsTick:", e);
    }

    if (isLoopRunning) {
        syncTimeoutId = setTimeout(syncLoopTick, getSyncIntervalSetting());
    }
}

function syncLoopTick() {
    updateLyricsTick();
}

function pingSpotifyStore() {
    if (!lastRawPayload) return;
    try {
        FluxDispatcher.dispatch({
            ...lastRawPayload,
            type: "SPOTIFY_PLAYER_STATE",
            position: getCurrentPosition(),
        });
    } catch (e) {
        debugError("[LyricStats] Error re-dispatching SPOTIFY_PLAYER_STATE:", e);
    }
}

async function handleSpotifyPlayerState(state: PlayerState) {
    try {
        debugLog("[LyricStats] Received player state:", state.track?.name, "isPlaying:", state.isPlaying, "position:", state.position);
        lastPlayerState = state;
        lastRawPayload = state;
        stateReceivedAt = Date.now();

        if (!state.track) {
            stopSyncLoop();
            currentLyricLine = null;
            previousLyricLine = null;
            lastTrackId = null;
            currentLyrics = [];
            return;
        }

        if (state.track.id !== lastTrackId) {
            lastTrackId = state.track.id;
            currentLyrics = [];

            const syncedLyrics = await fetchLyrics(state.track);
            if (syncedLyrics) {
                currentLyrics = parseLRC(syncedLyrics);
            } else {
                debugLog("[LyricStats] No synced lyrics available for this track.");
            }
        }

        if (state.isPlaying) {
            startSyncLoop();
            updateLyricsTick();
        } else {
            stopSyncLoop();
            currentLyricLine = null;
            previousLyricLine = null;
        }
    } catch (e) {
        debugError("[LyricStats] Error in handleSpotifyPlayerState:", e);
    }
}

function startSyncLoop() {
    if (isLoopRunning) return;
    debugLog("[LyricStats] Starting sync loop.");
    isLoopRunning = true;
    updateLyricsTick();
}

function stopSyncLoop() {
    debugLog("[LyricStats] Stopping sync loop.");
    isLoopRunning = false;
    if (syncTimeoutId) {
        clearTimeout(syncTimeoutId);
        syncTimeoutId = null;
    }
}

export default definePlugin({
    name: "LyricStats",
    description: "Shows the current line of the song playing on Spotify directly in your Spotify listening activity, instead of your custom status.",
    authors: [VeilDevs.Zarak],

    settings,

    patches: [
        {
            find: '"LocalActivityStore"',
            replacement: {
                match: /let (\i)=(\i)\.(\i)\.getActivity\(\);null!=\1&&/,
                replace: "let $1=$2.$3.getActivity();$self.patchActivity($1);null!=$1&&",
            }
        }
    ],

    patchActivity(activity: Activity) {
        if (!activity) return;

        debugLog("[LyricStats] patchActivity called, currentLyricLine:", currentLyricLine);

        if (!currentLyricLine) return;

        const field = getTargetFieldSetting();
        const prefix = getPrefixSetting();
        (activity as any)[field] = `${prefix}${currentLyricLine}`;

        debugLog("[LyricStats] wrote to", field, ":", (activity as any)[field]);
    },

    start() {
        debugLog("[LyricStats] Plugin started. Subscribing to FluxDispatcher...");
        setTimeout(() => {
            try {
                FluxDispatcher.subscribe("SPOTIFY_PLAYER_STATE", handleSpotifyPlayerState);
            } catch (e) {
                debugError("[LyricStats] Subscribing failed:", e);
            }
        }, 1000);
    },

    stop() {
        debugLog("[LyricStats] Plugin stopped.");
        try {
            FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", handleSpotifyPlayerState);
        } catch (e) {
            debugWarn("[LyricStats] Unsubscribing failed:", e);
        }
        stopSyncLoop();
        currentLyricLine = null;
        previousLyricLine = null;
        lastTrackId = null;
        currentLyrics = [];
        lastPlayerState = null;
    }
});
