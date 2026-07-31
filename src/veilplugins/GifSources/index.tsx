/*
 * Veil, a Discord client mod
 * MultiGifSource — adds results from other GIF providers alongside
 * Discord's native Tenor search, by intercepting the /gifs/search
 * network response rather than patching the (obfuscated, unstable)
 * picker component itself.
 *
 * Discord's GIF picker issues this request via XMLHttpRequest, not
 * fetch, so we subclass XMLHttpRequest. Because merging in extra
 * providers is async and XHR completion events are synchronous,
 * we have to buffer the "done" event (load/readystatechange@4) for
 * any listener Discord attaches, run the merge, patch the response
 * getters, and only then release the buffered calls — otherwise
 * Discord's code would read the original, unmerged body.
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
    enableTenor: {
        type: OptionType.BOOLEAN,
        description: "Include a second Tenor pass alongside Discord's built-in one (useful if you want a different limit/filter than Discord's own query)",
        default: false,
    },
    tenorApiKey: {
        type: OptionType.STRING,
        description: "Tenor API key — get a free one at tenor.com/gifapi. The default below is Google's shared public test key, heavily rate-limited across everyone using it.",
        default: "LIVDSRZULELA",
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

async function fetchTenor(query: string, limit: number): Promise<NormalizedGif[]> {
    const key = settings.store.tenorApiKey || "LIVDSRZULELA";
    const res = await fetch(
        `https://tenor.googleapis.com/v2/search?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=${limit}&media_filter=gif`
    );
    if (!res.ok) throw new Error(`Tenor HTTP ${res.status}`);
    const data = await res.json();
    return (data.results ?? []).map((g: any) => {
        const media = g.media_formats?.gif ?? g.media_formats?.mediumgif ?? g.media_formats?.tinygif;
        return {
            url: media?.url ?? g.itemurl,
            src: media?.url,
            width: Number(media?.dims?.[0]) || 0,
            height: Number(media?.dims?.[1]) || 0,
            format: "gif",
            title: g.content_description,
        };
    });
}

// Add more providers here as you find ones you like — same shape as
// fetchGiphy/fetchTenor: (query, limit) => Promise<NormalizedGif[]>
const ALL_PROVIDERS: Record<string, (query: string, limit: number) => Promise<NormalizedGif[]>> = {
    giphy: fetchGiphy,
    tenor: fetchTenor,
};

function activeProviders() {
    const list: Array<(q: string, l: number) => Promise<NormalizedGif[]>> = [];
    if (settings.store.enableGiphy) list.push(ALL_PROVIDERS.giphy);
    if (settings.store.enableTenor) list.push(ALL_PROVIDERS.tenor);
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

let origXHR: typeof XMLHttpRequest;

class VeilPatchedXHR extends XMLHttpRequest {
    private _veilQuery: string | null = null;
    private _veilPending: Array<() => void> = [];
    private _veilMergeStarted = false;
    private _veilPatchedText: string | null = null;
    private _veilPatchedObj: any = undefined;

    open(method: string, url: string | URL, ...rest: any[]) {
        const urlStr = url.toString();
        this._veilQuery = urlStr.includes(SEARCH_URL_FRAGMENT) ? extractQuery(urlStr) : null;
        // @ts-ignore — variadic open() overloads
        return super.open(method, url, ...rest);
    }

    private _veilWrap(type: "load" | "readystatechange", listener: any) {
        const self = this;
        return function (this: any, ev: Event) {
            if (type === "readystatechange" && self.readyState !== 4) {
                return listener.call(this, ev);
            }
            self._veilPending.push(() => listener.call(this, ev));
            self._veilMaybeMerge();
        };
    }

    addEventListener(type: string, listener: any, options?: any) {
        if (this._veilQuery && listener && (type === "readystatechange" || type === "load" || type === "loadend")) {
            return super.addEventListener(type, this._veilWrap(type === "readystatechange" ? "readystatechange" : "load", listener), options);
        }
        return super.addEventListener(type, listener, options);
    }

    set onload(fn: any) {
        super.onload = (this._veilQuery && fn) ? this._veilWrap("load", fn) : fn;
    }
    get onload() {
        return super.onload;
    }

    set onreadystatechange(fn: any) {
        super.onreadystatechange = (this._veilQuery && fn) ? this._veilWrap("readystatechange", fn) : fn;
    }
    get onreadystatechange() {
        return super.onreadystatechange;
    }

    get response() {
        if (this._veilPatchedObj !== undefined) return this._veilPatchedObj;
        if (this._veilPatchedText !== null) return this._veilPatchedText;
        return super.response;
    }

    get responseText() {
        return this._veilPatchedText ?? super.responseText;
    }

    private _veilMaybeMerge() {
        if (this._veilMergeStarted) return;
        this._veilMergeStarted = true;

        if (!this._veilQuery || this.status < 200 || this.status >= 300) {
            return this._veilFlush();
        }

        (async () => {
            try {
                const type = this.responseType;
                let json: any;
                if (type === "" || type === "text") {
                    json = JSON.parse(super.responseText);
                } else if (type === "json") {
                    json = super.response;
                } else {
                    // arraybuffer/blob/document — not our shape, leave untouched
                    return;
                }

                const nativeArray = findResultArray(json);
                if (!nativeArray) return;

                const merged = await mergeExtraProviders(this._veilQuery!, nativeArray);
                const patched = patchResultArrayInPlace(json, merged);

                if (type === "json") this._veilPatchedObj = patched;
                else this._veilPatchedText = JSON.stringify(patched);
            } catch (e) {
                console.error("[MultiGifSource] Failed to merge providers, passing through native response:", e);
            } finally {
                this._veilFlush();
            }
        })();
    }

    private _veilFlush() {
        const calls = this._veilPending;
        this._veilPending = [];
        for (const call of calls) call();
    }
}

export default definePlugin({
    name: "MultiGifSource",
    description: "Adds results from other GIF providers (Giphy, Tenor, etc.) alongside Discord's native Tenor search.",
    authors: [VeilDevs.Zarak],
    settings,

    start() {
        origXHR = window.XMLHttpRequest;
        // @ts-ignore
        window.XMLHttpRequest = VeilPatchedXHR;
    },

    stop() {
        if (origXHR) window.XMLHttpRequest = origXHR;
    },
});
