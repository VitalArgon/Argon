/*
 * Veil, a Discord client mod
 * MultiGifSource — adds results from other GIF providers alongside
 * Discord's native Tenor search, by intercepting the /gifs/search
 * network response rather than patching the (obfuscated, unstable)
 * picker component itself.
 */

import { definePluginSettings } from "@api/Settings";
import { VeilDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    enableGiphy: {
        type: OptionType.BOOLEAN,
        description: "Include results from Giphy",
        default: true,
    },
    giphyApiKey: {
        type: OptionType.STRING,
        description: "Giphy API key — get a free one at developers.giphy.com. The default below is Giphy's shared public beta key, heavily rate-limited across everyone using it.",
        default: "dc6zaTOxFJmzC",
    },
    resultsPerProvider: {
        type: OptionType.NUMBER,
        description: "How many results to pull from each extra provider per search",
        default: 15,
    },
});

interface NormalizedGif {
    url: string;
    src: string;
    width: number;
    height: number;
    format?: string;
    title?: string;
}

async function fetchGiphy(query: string, limit: number): Promise<NormalizedGif[]> {
    const key = settings.store.giphyApiKey || "dc6zaTOxFJmzC";
    const res = await fetch(
        `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=${limit}&rating=r`
    );
    if (!res.ok) throw new Error(`Giphy HTTP ${res.status}`);
    const data = await res.json();
    return (data.data ?? []).map((g: any) => ({
        url: g.images?.original?.url ?? g.url,
        src: g.images?.original?.url,
        width: Number(g.images?.original?.width) || 0,
        height: Number(g.images?.original?.height) || 0,
        format: "gif",
        title: g.title,
    }));
}

// Add more providers here as you find ones you like — same shape as fetchGiphy:
// (query, limit) => Promise<NormalizedGif[]>
const ALL_PROVIDERS: Record<string, (query: string, limit: number) => Promise<NormalizedGif[]>> = {
    giphy: fetchGiphy,
};

function activeProviders() {
    const list: Array<(q: string, l: number) => Promise<NormalizedGif[]>> = [];
    if (settings.store.enableGiphy) list.push(ALL_PROVIDERS.giphy);
    return list;
}

const SEARCH_URL_FRAGMENT = "/gifs/search";

function extractQuery(urlStr: string): string | null {
    try {
        return new URL(urlStr, location.origin).searchParams.get("q");
    } catch {
        return null;
    }
}

/** Builds a Discord-shaped result object for a foreign GIF by copying a real result's field names. */
function mimicShape(template: any, gif: NormalizedGif) {
    const clone = { ...template };
    for (const key of Object.keys(clone)) {
        const lower = key.toLowerCase();
        if (lower.includes("url") && !lower.includes("preview")) clone[key] = gif.url;
        else if (lower === "src") clone[key] = gif.src;
        else if (lower === "width") clone[key] = gif.width;
        else if (lower === "height") clone[key] = gif.height;
        else if (lower === "format") clone[key] = gif.format ?? clone[key];
        else if (lower === "title") clone[key] = gif.title ?? clone[key];
        else if (lower === "id") clone[key] = `multigif-${Math.random().toString(36).slice(2)}`;
    }
    return clone;
}

async function mergeExtraProviders(query: string, nativeResults: any[]): Promise<any[]> {
    if (!nativeResults?.length || !query) return nativeResults;
    const providers = activeProviders();
    if (!providers.length) return nativeResults;

    const template = nativeResults[0];
    const limit = settings.store.resultsPerProvider;
    const settled = await Promise.allSettled(providers.map(fn => fn(query, limit)));

    const extras: any[] = [];
    for (const r of settled) {
        if (r.status === "fulfilled") {
            extras.push(...r.value.map(gif => mimicShape(template, gif)));
        } else {
            console.error("[MultiGifSource] Provider failed:", r.reason);
        }
    }

    return [...nativeResults, ...extras];
}

/** Walks the parsed response looking for the array of GIF result objects. */
function findResultArray(json: any): any[] | null {
    if (Array.isArray(json)) return json;
    if (json && typeof json === "object") {
        for (const key of ["results", "gifs", "data", "items"]) {
            if (Array.isArray(json[key])) return json[key];
        }
    }
    return null;
}

function patchResultArrayInPlace(json: any, newArray: any[]) {
    if (Array.isArray(json)) {
        json.length = 0;
        json.push(...newArray);
        return json;
    }
    for (const key of ["results", "gifs", "data", "items"]) {
        if (Array.isArray(json[key])) {
            json[key] = newArray;
            return json;
        }
    }
    return json;
}

let origFetch: typeof window.fetch;

function patchedFetchFactory(orig: typeof window.fetch): typeof window.fetch {
    return async function (this: any, ...args: Parameters<typeof fetch>) {
        const url = typeof args[0] === "string" ? args[0] : (args[0] as Request).url;
        if (!url.includes(SEARCH_URL_FRAGMENT)) {
            return orig.apply(this, args);
        }

        const query = extractQuery(url);
        const response = await orig.apply(this, args);
        if (!query || !response.ok) return response;

        try {
            const json = await response.clone().json();
            const nativeArray = findResultArray(json);
            if (!nativeArray) return response;

            const merged = await mergeExtraProviders(query, nativeArray);
            const patchedJson = patchResultArrayInPlace(json, merged);

            return new Response(JSON.stringify(patchedJson), {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
            });
        } catch (e) {
            console.error("[MultiGifSource] Failed to merge providers, passing through native response:", e);
            return response;
        }
    };
}

export default definePlugin({
    name: "MultiGifSource",
    description: "Adds results from other GIF providers (Giphy, etc.) alongside Discord's native Tenor search.",
    authors: [VeilDevs.Zarak],
    settings,

    start() {
        origFetch = window.fetch;
        window.fetch = patchedFetchFactory(origFetch);
    },

    stop() {
        if (origFetch) window.fetch = origFetch;
    },
});
