/*
 * Argon, a Discord client mod
 * MultiGifSource — a /multi-gif command that searches GIF providers
 * (Giphy, Klipy, etc.) directly and shows the results in a picker
 * modal. Deliberately doesn't touch Discord's own GIF picker or its
 * network requests at all, so none of Discord's own result filtering
 * (which was crashing a different plugin) applies here.
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { ArgonDevs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { React } from "@webpack/common";

// NOTE: don't do `const h = React.createElement` at module scope —
// this file is evaluated once on load, and if @webpack/common's React
// export isn't fully resolved at that exact moment, grabbing a method
// off it immediately throws and the whole plugin fails to register.
// Wrapping it in a function defers the property access until we
// actually render, by which point React is available.
function h(...args: Parameters<typeof React.createElement>) {
    return React.createElement(...args);
}

const settings = definePluginSettings({
    enableGiphy: {
        type: OptionType.BOOLEAN,
        description: "Include results from Giphy",
        default: true,
    },
    giphyApiKey: {
        type: OptionType.STRING,
        description: "Giphy API key — get a free one at developers.giphy.com (choose 'API', not 'SDK', when creating the app).",
        default: "",
    },
    enableKlipy: {
        type: OptionType.BOOLEAN,
        description: "Include results from Klipy (free, no usage costs — get a key at klipy.com/developers)",
        default: false,
    },
    klipyApiKey: {
        type: OptionType.STRING,
        description: "Klipy API key — get one at klipy.com/developers.",
        default: "",
    },
    resultsPerProvider: {
        type: OptionType.NUMBER,
        description: "How many results to pull from each provider per search",
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
    const key = settings.store.giphyApiKey;
    if (!key) return [];
    const res = await fetch(
        `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=${limit}&rating=pg-13`
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

async function fetchKlipy(query: string, limit: number): Promise<NormalizedGif[]> {
    const key = settings.store.klipyApiKey;
    if (!key) return [];
    const res = await fetch(
        `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/search?q=${encodeURIComponent(query)}&per_page=${Math.min(Math.max(limit, 8), 50)}`
    );
    if (!res.ok) throw new Error(`Klipy HTTP ${res.status}`);
    const json = await res.json();
    const items = json?.data?.data ?? [];
    return items.map((g: any) => {
        // Klipy exposes GIF variants under a `files` object; the exact
        // sub-key names aren't in their public docs (JS-rendered page),
        // so this tries the most likely shapes. If results come back
        // empty, console.log(g) here once you have a working key to see
        // the real field names and adjust.
        const files = g.files ?? {};
        const variant = files.gif ?? files.hd ?? files.md ?? files.sm ?? files.original ?? {};
        const url = variant.url ?? variant.src ?? g.url;
        return {
            url,
            src: url,
            width: Number(variant.width) || 0,
            height: Number(variant.height) || 0,
            format: "gif",
            title: g.title,
        };
    }).filter((g: NormalizedGif) => !!g.url);
}

// Add more providers here as you find ones you like — same shape as
// fetchGiphy/fetchKlipy: (query, limit) => Promise<NormalizedGif[]>
const ALL_PROVIDERS: Record<string, (query: string, limit: number) => Promise<NormalizedGif[]>> = {
    giphy: fetchGiphy,
    klipy: fetchKlipy,
};

function activeProviders() {
    const list: Array<(q: string, l: number) => Promise<NormalizedGif[]>> = [];
    if (settings.store.enableGiphy) list.push(ALL_PROVIDERS.giphy);
    if (settings.store.enableKlipy) list.push(ALL_PROVIDERS.klipy);
    return list;
}

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
                        ? h("div", null, "No results — check that at least one provider is enabled and has a valid API key in plugin settings.")
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
    description: "Search GIFs across Giphy, Klipy, etc. directly with /multi-gif — bypasses Discord's own picker and filtering entirely.",
    authors: [ArgonDevs.Zarak], // replace with your own entry
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
});
