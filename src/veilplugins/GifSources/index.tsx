/*
 * Veil, a Discord client mod
 * MultiGifSource — adds results from other GIF providers alongside
 * Discord's native Tenor search, by intercepting the /gifs/search
 * network response, PLUS a standalone /multi-gif command that
 * searches providers directly and never touches Discord's picker
 * or its result filtering at all.
 *
 * Discord's GIF picker issues its search via XMLHttpRequest, not
 * fetch, so the passive interceptor subclasses XMLHttpRequest.
 * Because merging in extra providers is async and XHR completion
 * events are synchronous, we buffer the "done" event for any
 * listener Discord attaches, run the merge, patch the response
 * getters, and only then release the buffered calls.
 *
 * The /multi-gif command is a separate, independent path: it never
 * goes near Discord's request/response cycle, so whatever Discord's
 * own filtering does (that was tripping up another plugin) simply
 * doesn't apply to it.
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { VeilDevs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

const h = React.createElement;

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
        description: "Include results from Tenor",
        default: false,
    },
    tenorApiKey: {
        type: OptionType.STRING,
        description: "Tenor API key — get a free one at tenor.com/gifapi. The default below is Google's shared public test key, heavily rate-limited across everyone using it.",
        default: "LIVDSRZULELA",
    },
    resultsPerProvider: {
        type: OptionType.NUMBER,
        description: "How many results to pull from each provider per search",
        default: 15,
    },
    enablePickerIntercept: {
        type: OptionType.BOOLEAN,
        description: "Also inject extra results into Discord's native GIF picker (disable this if it's the thing causing crashes elsewhere — /multi-gif works independently of this setting)",
        default: true,
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

/** Used by /multi-gif: hits every enabled provider directly and returns the flat, unfiltered list. */
async function searchAllProviders(query: string): Promise<NormalizedGif[]> {
    const providers = activeProviders();
    if (!providers.length || !query.trim()) return [];

    const limit = settings.store.resultsPerProvider;
    const settled = await Promise.allSettled(providers.map(fn => fn(query, limit)));

    const out: NormalizedGif[] = [];
    for (const r of settled) {
        if (r.status === "fulfilled") out.push(...r.value);
        else console.error("[MultiGifSource] Provider failed:", r.reason);
    }
    return out;
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
        this._veilQuery = (settings.store.enablePickerIntercept && urlStr.includes(SEARCH_URL_FRAGMENT))
            ? extractQuery(urlStr)
            : null;
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

function GifPickerModal({ modalProps, initialQuery }: { modalProps: any; initialQuery: string; }) {
    const [query, setQuery] = React.useState(initialQuery);
    const [pending, setPending] = React.useState(true);
    const [results, setResults] = React.useState<NormalizedGif[]>([]);
    const [error, setError] = React.useState<string | null>(null);

    const runSearch = async (q: string) => {
        setPending(true);
        setError(null);
        try {
            setResults(await searchAllProviders(q));
        } catch (e) {
            setError(String(e));
        } finally {
            setPending(false);
        }
    };

    React.useEffect(() => { runSearch(initialQuery); }, []);

    return h(ModalRoot, { ...modalProps, size: ModalSize.LARGE },
        h(ModalHeader, null,
            h("input", {
                type: "text",
                value: query,
                onChange: (e: any) => setQuery(e.target.value),
                onKeyDown: (e: any) => { if (e.key === "Enter") runSearch(query); },
                placeholder: "Search GIFs…",
                autoFocus: true,
                style: {
                    flex: 1,
                    background: "var(--input-background)",
                    color: "var(--text-normal)",
                    border: "none",
                    borderRadius: 4,
                    padding: "8px 10px",
                },
            }),
            h(ModalCloseButton, { onClick: modalProps.onClose })
        ),
        h(ModalContent, { style: { padding: 16 } },
            pending
                ? h("div", null, "Searching…")
                : error
                    ? h("div", { style: { color: "var(--text-danger)" } }, error)
                    : !results.length
                        ? h("div", null, "No results — check that at least one provider is enabled in plugin settings.")
                        : h("div", {
                            style: {
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                gap: 8,
                            },
                        }, results.map((gif, i) =>
                            h("img", {
                                key: `${gif.url}-${i}`,
                                src: gif.src || gif.url,
                                title: gif.title ?? "",
                                loading: "lazy",
                                style: {
                                    width: "100%",
                                    aspectRatio: "1 / 1",
                                    objectFit: "cover",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                },
                                onClick: () => {
                                    insertTextIntoChatInputBox(gif.url + " ");
                                    modalProps.onClose();
                                },
                            })
                        ))
        )
    );
}

export default definePlugin({
    name: "MultiGifSource",
    description: "Adds results from other GIF providers (Giphy, Tenor, etc.) alongside Discord's native Tenor search, plus a /multi-gif command that searches them directly without going through Discord's picker at all.",
    authors: [VeilDevs.Zarak], // replace with your own entry
    settings,
    dependencies: ["CommandsAPI"],

    commands: [
        {
            name: "multi-gif",
            description: "Search GIFs across your configured providers directly — bypasses Discord's picker and its filtering entirely",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "query",
                    description: "What to search for",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: async (opts, _ctx) => {
                const query = findOption(opts, "query", "");
                openModal(modalProps => h(GifPickerModal, { modalProps, initialQuery: query }));
            },
        },
    ],

    start() {
        origXHR = window.XMLHttpRequest;
        // @ts-ignore
        window.XMLHttpRequest = VeilPatchedXHR;
    },

    stop() {
        if (origXHR) window.XMLHttpRequest = origXHR;
    },
});
