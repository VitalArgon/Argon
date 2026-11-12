/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { ArgonDevs } from "@utils/constants";
import { insertTextIntoChatInputBox } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Modal, openModal, React } from "@webpack/common";

// NOTE: don't do `const h = React.createElement` at module scope —
// this file is evaluated once on load, and if @webpack/common's React
// export isn't fully resolved at that exact moment, grabbing a method
// off it immediately throws and the whole plugin fails to register.
// Wrapping it in a function defers the property access until we
// actually render, by which point React is available.
function h(type: any, props?: any, ...children: any[]) {
    return React.createElement(type, props, ...children);
}

// Google's image search page is rendered entirely by JavaScript and sends
// no CORS headers, so its HTML cannot be parsed from inside Discord. The
// Programmable Search JSON API is Google's own supported route to the same
// index: same results, real GIFs, and it does allow browser requests.
const GOOGLE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const PAGE_SIZE = 10;
const LAST_START = 91;

const settings = definePluginSettings({
    googleApiKey: {
        type: OptionType.STRING,
        description: "Google API key. In console.cloud.google.com enable the \"Custom Search API\" and create an API key. The free tier is 100 searches a day, and each page of results costs one.",
        default: "",
    },
    googleCx: {
        type: OptionType.STRING,
        description: "Search engine ID (cx). Create one at programmablesearchengine.google.com with \"Search the entire web\" switched on, then copy the cx value from the setup page.",
        default: "",
    },
    safeSearch: {
        type: OptionType.BOOLEAN,
        description: "Filter explicit results",
        default: true,
    },
    resultsPerSearch: {
        type: OptionType.NUMBER,
        description: "How many GIFs to load per search. Google returns 10 per request, so 20 costs two of your daily searches.",
        default: 20,
    },
});

interface Gif {
    url: string;
    preview: string;
    width: number;
    height: number;
    title?: string;
}

interface GoogleImageItem {
    link?: string;
    title?: string;
    image?: {
        thumbnailLink?: string;
        width?: number;
        height?: number;
    };
}

function explainError(status: number, message: string) {
    if (status === 400 && /api key not valid/i.test(message))
        return "Google rejected the API key. Check the key in plugin settings, and make sure the Custom Search API is enabled for the project that key belongs to.";
    if (status === 400 && /\bcx\b|invalid value/i.test(message))
        return "Google rejected the search engine ID. Copy the cx value from your Programmable Search Engine's setup page.";
    if (status === 403)
        return "Google refused the request. Usually the Custom Search API is not enabled for that key, or the search engine is not set to \"Search the entire web\".";
    if (status === 429)
        return "The free daily quota is used up. It resets at midnight Pacific time, or you can raise the quota in the Google Cloud console.";
    return `Google returned HTTP ${status}${message ? `: ${message}` : "."}`;
}

async function requestPage(query: string, start: number): Promise<{ gifs: Gif[]; total: number; }> {
    const key = settings.store.googleApiKey.trim();
    const cx = settings.store.googleCx.trim();
    if (!key || !cx) throw new Error("Add your Google API key and search engine ID in the plugin settings first.");

    const params = new URLSearchParams({
        key,
        cx,
        q: query,
        searchType: "image",
        fileType: "gif",
        num: String(PAGE_SIZE),
        start: String(start),
        safe: settings.store.safeSearch ? "active" : "off",
    });

    const res = await fetch(`${GOOGLE_ENDPOINT}?${params.toString()}`);
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(explainError(res.status, json?.error?.message ?? ""));

    const items: GoogleImageItem[] = json?.items ?? [];
    const gifs = items.flatMap(item => {
        const url = item.link;
        if (!url) return [];
        return [{
            url,
            preview: item.image?.thumbnailLink ?? url,
            width: Number(item.image?.width) || 0,
            height: Number(item.image?.height) || 0,
            title: item.title,
        }];
    });

    return { gifs, total: Number(json?.searchInformation?.totalResults) || 0 };
}

async function searchGoogle(query: string, start: number, limit: number) {
    const gifs: Gif[] = [];
    let total = 0;
    let cursor = start;

    while (gifs.length < limit && cursor <= LAST_START) {
        const page = await requestPage(query, cursor);
        total = page.total;
        if (!page.gifs.length) {
            cursor = LAST_START + PAGE_SIZE;
            break;
        }
        gifs.push(...page.gifs);
        cursor += PAGE_SIZE;
    }

    return { gifs: gifs.slice(0, limit), nextStart: cursor, total };
}

function GifPickerModal({ modalProps, initialQuery }: { modalProps: any; initialQuery: string; }) {
    const [query, setQuery] = React.useState(initialQuery);
    const [pending, setPending] = React.useState(false);
    const [results, setResults] = React.useState<Gif[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [nextStart, setNextStart] = React.useState(1);
    const [total, setTotal] = React.useState(0);

    const runSearch = async (q: string) => {
        if (!q.trim()) return;
        setPending(true);
        setError(null);
        try {
            const page = await searchGoogle(q, 1, settings.store.resultsPerSearch);
            setResults(page.gifs);
            setNextStart(page.nextStart);
            setTotal(page.total);
        } catch (e) {
            setResults([]);
            setError(String(e instanceof Error ? e.message : e));
        } finally {
            setPending(false);
        }
    };

    const loadMore = async () => {
        setPending(true);
        setError(null);
        try {
            const page = await searchGoogle(query, nextStart, settings.store.resultsPerSearch);
            setResults(prev => [...prev, ...page.gifs]);
            setNextStart(page.nextStart);
            setTotal(page.total);
        } catch (e) {
            setError(String(e instanceof Error ? e.message : e));
        } finally {
            setPending(false);
        }
    };

    React.useEffect(() => { runSearch(initialQuery); }, []);

    const hasMore = nextStart <= LAST_START && (total === 0 || results.length < total);

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Search GIFs"
            actions={[
                ...(hasMore && !pending && !error
                    ? [{ text: "Load more", variant: "primary" as const, onClick: loadMore }]
                    : []),
                { text: "Close", variant: "secondary" as const, onClick: () => modalProps.onClose() },
            ]}
        >
            <input
                type="text"
                value={query}
                onChange={(e: any) => setQuery(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === "Enter") runSearch(query); }}
                placeholder="Search GIFs…"
                autoFocus
                style={{
                    width: "100%",
                    boxSizing: "border-box",
                    marginBottom: 12,
                    background: "var(--input-background)",
                    color: "var(--text-normal)",
                    border: "none",
                    borderRadius: 4,
                    padding: "8px 10px",
                }}
            />
            {pending
                ? <div>Searching…</div>
                : error
                    ? <div style={{ color: "var(--text-danger)" }}>{error}</div>
                    : !results.length
                        ? <div>No results. Check the API key and cx in plugin settings, then try another search.</div>
                        : (
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                gap: 8,
                            }}>
                                {results.map((gif, i) => (
                                    <img
                                        key={`${gif.url}-${i}`}
                                        src={gif.preview}
                                        title={gif.title ?? ""}
                                        loading="lazy"
                                        style={{
                                            width: "100%",
                                            aspectRatio: "1 / 1",
                                            objectFit: "cover",
                                            borderRadius: 4,
                                            cursor: "pointer",
                                        }}
                                        onClick={() => {
                                            insertTextIntoChatInputBox(gif.url + " ");
                                            modalProps.onClose();
                                        }}
                                    />
                                ))}
                            </div>
                        )}
        </Modal>
    );
}

export default definePlugin({
    name: "GifSources",
    description: "Search Google for GIFs with /gif and drop the result straight into the chat box. One source, no API key juggling between providers, and none of Discord's own picker filtering.",
    authors: [ArgonDevs.Zarak],
    settings,
    dependencies: ["CommandsAPI"],

    commands: [
        {
            name: "gif",
            description: "Search Google for a GIF and put it in the chat box",
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
