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

// Discord's own GIF endpoints, the ones its picker calls. No key, no account
// setup, no third party: the client already talks to these, and being on
// discord.com they are same origin, so there is no CORS problem either.
// `limit` is capped at 100 by the server and there is no offset, so "more"
// means asking the same query for a bigger page rather than paging.
const ENDPOINT = "https://discord.com/api/v9/gifs";
const MIN_LIMIT = 20;
const MAX_LIMIT = 100;
const LOAD_MORE_STEP = 40;

const settings = definePluginSettings({
    resultsPerSearch: {
        type: OptionType.NUMBER,
        description: "How many GIFs a search loads. Discord serves between 20 and 100 per request; anything outside that is clamped.",
        default: 50,
    },
    trendingOnEmpty: {
        type: OptionType.BOOLEAN,
        description: "Show trending GIFs when the search box is empty or the query is blank",
        default: true,
    },
});

interface Gif {
    /** The .gif itself, which is what gets inserted into the chat box. */
    url: string;
    /** Lighter webp used for the grid, so a page of 50 does not pull 50 full GIFs. */
    preview: string;
    /** The gif's page on the provider, kept for the tooltip. */
    page: string;
    title: string;
    width: number;
    height: number;
}

interface DiscordGif {
    id?: string;
    title?: string;
    url?: string;
    src?: string;
    gif_src?: string;
    preview?: string;
    width?: number;
    height?: number;
}

function clampLimit(n: number) {
    const value = Math.round(Number(n) || 0);
    return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, value));
}

function toGif(item: DiscordGif): Gif | null {
    const url = item.src ?? item.preview;
    if (!url) return null;
    return {
        url,
        preview: item.gif_src ?? item.preview ?? url,
        page: item.url ?? url,
        title: item.title ?? "",
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
    };
}

function retryAfterSeconds(res: Response, body: any) {
    const header = Number(res.headers.get("retry-after"));
    if (Number.isFinite(header) && header > 0) return Math.ceil(header);
    const fromBody = Number(body?.retry_after);
    if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
    return 0;
}

function explainError(status: number, body: any) {
    if (status === 429) {
        const wait = Number(body?.retry_after) > 0 ? Math.ceil(Number(body.retry_after)) : 0;
        return wait
            ? `Discord is rate limiting GIF searches. Try again in ${wait} second${wait === 1 ? "" : "s"}.`
            : "Discord is rate limiting GIF searches. Wait a moment and try again.";
    }
    if (status === 400) return "Discord rejected that search. Try a shorter or simpler query.";
    if (status === 401 || status === 403) return "Discord would not answer the GIF request. Try again, and if it keeps happening, reload the client.";
    if (status === 404) return "Discord's GIF service returned nothing for that search. Try another word.";
    if (status >= 500) return `Discord's GIF service is having trouble (HTTP ${status}). Try again shortly.`;
    const message = body?.message ? `: ${body.message}` : ".";
    return `Discord returned HTTP ${status}${message}`;
}

async function searchGifs(query: string, limit: number, signal: AbortSignal): Promise<Gif[]> {
    const count = clampLimit(limit);
    const q = query.trim();
    const params = new URLSearchParams({ limit: String(count), media_format: "gif" });

    const trending = !q && settings.store.trendingOnEmpty;
    if (!trending) params.set("q", q);

    const res = await fetch(`${ENDPOINT}/${trending ? "trending-gifs" : "search"}?${params}`, { signal });
    const body = await res.json().catch(() => null);

    if (!res.ok) {
        const timeLeft = retryAfterSeconds(res, body);
        if (res.status === 429 && timeLeft) throw new Error(`Discord is rate limiting GIF searches. Try again in ${timeLeft} second${timeLeft === 1 ? "" : "s"}.`);
        throw new Error(explainError(res.status, body));
    }

    const items: DiscordGif[] = Array.isArray(body) ? body : [];
    return items.map(toGif).filter((gif): gif is Gif => gif !== null);
}

function GifPickerModal({ modalProps, initialQuery }: { modalProps: any; initialQuery: string; }) {
    const [query, setQuery] = React.useState(initialQuery);
    const [pending, setPending] = React.useState(false);
    const [results, setResults] = React.useState<Gif[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [limit, setLimit] = React.useState(() => clampLimit(settings.store.resultsPerSearch));

    const inflight = React.useRef<AbortController | null>(null);

    const run = React.useCallback(async (q: string, nextLimit: number) => {
        inflight.current?.abort();
        const controller = new AbortController();
        inflight.current = controller;

        setPending(true);
        setError(null);
        try {
            const gifs = await searchGifs(q, nextLimit, controller.signal);
            setResults(gifs);
            setLimit(nextLimit);
        } catch (e) {
            if (controller.signal.aborted) return;
            setResults([]);
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            if (!controller.signal.aborted) setPending(false);
        }
    }, []);

    React.useEffect(() => {
        run(initialQuery, clampLimit(settings.store.resultsPerSearch));
        return () => inflight.current?.abort();
    }, []);

    const canLoadMore = limit < MAX_LIMIT && results.length >= limit && !pending && !error;

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Search GIFs"
            actions={[
                ...(canLoadMore
                    ? [{
                        text: "Load more",
                        variant: "primary" as const,
                        onClick: () => run(query, Math.min(MAX_LIMIT, limit + LOAD_MORE_STEP)),
                    }]
                    : []),
                { text: "Close", variant: "secondary" as const, onClick: () => modalProps.onClose() },
            ]}
        >
            <input
                type="text"
                value={query}
                onChange={(e: any) => setQuery(e.target.value)}
                onKeyDown={(e: any) => { if (e.key === "Enter") run(query, clampLimit(settings.store.resultsPerSearch)); }}
                placeholder="Search GIFs, or press Enter for trending…"
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
                        ? <div>No GIFs came back. Try a different word.</div>
                        : (
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                gap: 8,
                            }}>
                                {results.map((gif, i) => (
                                    <img
                                        key={`${gif.page}-${i}`}
                                        src={gif.preview}
                                        title={gif.title || gif.page}
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
    description: "Search GIFs with /gif and drop the result straight into the chat box. Uses Discord's own GIF service, so there is no API key to fetch, no quota, and none of the picker's own filtering.",
    authors: [ArgonDevs.Zarak],
    settings,
    dependencies: ["CommandsAPI"],

    commands: [
        {
            name: "gif",
            description: "Search GIFs and put one in the chat box",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "query",
                    description: "What to search for. Leave empty for trending.",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                },
            ],
            execute: async (opts, _ctx) => {
                const query = findOption(opts, "query", "");
                openModal(modalProps => h(GifPickerModal, { modalProps, initialQuery: query }));
            },
        },
    ],
});
