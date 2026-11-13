/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    findOption,
} from "@api/Commands";
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

// Neither of these is a secret. Both are the keys the providers' own public
// websites hand to every visitor, baked in so a search works out of the box
// with no signup. If one starts refusing requests (they get rotated, or a
// shared key runs into its rate limit), paste your own in plugin settings;
// a personal key is also faster and never shared with anyone else.
const DEFAULT_GIPHY_KEY = "GlVGYHkr3WSBnllca54iNt0yFbjz7L65";
const DEFAULT_TENOR_KEY = "AIzaSyCZt6SSh5VgVPzD9fhyzG1DprdPRhtoaR4";

const DISCORD_MIN = 20;
const DISCORD_MAX = 100;
const DISCORD_STEP = 40;

const settings = definePluginSettings({
    includeNsfw: {
        type: OptionType.BOOLEAN,
        description:
            "Allow explicit results. Giphy and Tenor both filter their results when this is off. Discord's own GIF service never has explicit results either way.",
        default: true,
    },
    enableGiphy: {
        type: OptionType.BOOLEAN,
        description: "Search Giphy (no key needed, uses a shared public key you can replace below)",
        default: true,
    },
    enableTenor: {
        type: OptionType.BOOLEAN,
        description: "Search Tenor (no key needed, uses the key tenor.com itself uses)",
        default: true,
    },
    enableDiscord: {
        type: OptionType.BOOLEAN,
        description:
            "Search Discord's own GIF service as a fallback. No key, no quota, but nothing explicit.",
        default: true,
    },
    resultsPerSource: {
        type: OptionType.NUMBER,
        description: "How many results to pull from each source per page",
        default: 20,
    },
    trendingOnEmpty: {
        type: OptionType.BOOLEAN,
        description: "Show trending GIFs when the query is empty",
        default: true,
    },
    giphyApiKey: {
        type: OptionType.STRING,
        description:
            "Giphy API key. Leave as is to use the shared public key; your own avoids the shared rate limit.",
        default: DEFAULT_GIPHY_KEY,
    },
    tenorApiKey: {
        type: OptionType.STRING,
        description: "Tenor API key. Leave as is to use Tenor's own public web key.",
        default: DEFAULT_TENOR_KEY,
    },
});

interface Gif {
    /** The .gif itself, which is what gets inserted into the chat box. */
    url: string;
    /** Lighter image for the grid, so a page of results does not pull every full GIF. */
    preview: string;
    /** The result's page on the provider, used for the tooltip. */
    page: string;
    title: string;
    width: number;
    height: number;
    provider: ProviderId;
    /** True when the provider itself flagged this result as explicit. */
    nsfw: boolean;
}

type ProviderId = "giphy" | "tenor" | "discord";

interface SearchOptions {
    nsfw: boolean;
    signal: AbortSignal;
}

interface ProviderPage {
    items: Gif[];
    /** Opaque cursor for the next page, or null when there is none. */
    next: string | null;
}

interface Provider {
    id: ProviderId;
    label: string;
    enabled(): boolean;
}

function clamp(n: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Math.round(Number(n) || 0)));
}

function retryAfterSeconds(res: Response, body: any) {
    const header = Number(res.headers.get("retry-after"));
    if (Number.isFinite(header) && header > 0) return Math.ceil(header);
    const fromBody = Number(body?.retry_after);
    if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
    return 0;
}

/** Turns an HTTP failure from any provider into a line a person can act on. */
async function explainFailure(name: string, res: Response, keySetting?: string): Promise<string> {
    const body = await res.json().catch(() => null);
    const apiMessage: string | undefined = body?.error?.message ?? body?.meta?.msg ?? body?.message;

    if (res.status === 429) {
        const wait = retryAfterSeconds(res, body);
        const suffix = wait
            ? ` Try again in ${wait} second${wait === 1 ? "" : "s"}.`
            : " Wait a moment and try again.";
        return `${name} is rate limiting searches.${suffix}`;
    }
    if (res.status === 401 || res.status === 403) {
        const where = keySetting
            ? ` Replace the key in plugin settings (${keySetting}) with your own.`
            : "";
        return `${name} refused the API key.${where}` || `${name} refused the request.`;
    }
    if (res.status === 400) return `${name} rejected that search. Try a shorter or simpler query.`;
    if (res.status === 404) return `${name} has nothing for that search. Try another word.`;
    if (res.status >= 500)
        return `${name} is having trouble right now (HTTP ${res.status}). Try again shortly.`;
    return `${name} returned HTTP ${res.status}${apiMessage ? `: ${apiMessage}` : "."}`;
}

// ---------------------------------------------------------------- Giphy

interface GiphyImage {
    url?: string;
    width?: string;
    height?: string;
}

interface GiphyItem {
    id?: string;
    title?: string;
    url?: string;
    rating?: string;
    images?: Record<string, GiphyImage>;
}

function fromGiphy(item: GiphyItem): Gif | null {
    const images = item.images ?? {};
    const full = images.original?.url;
    if (!full) return null;
    return {
        url: full,
        preview: images.fixed_width?.url ?? images.downsized?.url ?? full,
        page: item.url ?? full,
        title: item.title ?? "",
        width: Number(images.original?.width) || 0,
        height: Number(images.original?.height) || 0,
        provider: "giphy",
        nsfw: item.rating === "r",
    };
}

async function searchGiphy(
    query: string,
    cursor: string | null,
    limit: number,
    opts: SearchOptions,
): Promise<ProviderPage> {
    const key = (settings.store.giphyApiKey || "").trim() || DEFAULT_GIPHY_KEY;
    const offset = Number(cursor) || 0;

    const params = new URLSearchParams({
        api_key: key,
        limit: String(limit),
        offset: String(offset),
        lang: "en",
    });
    if (query) params.set("q", query);
    // No rating parameter at all is what Giphy treats as "everything", and it
    // is the only way its R-rated results show up.
    if (!opts.nsfw) params.set("rating", "pg-13");

    const path = query ? "search" : "trending";
    const res = await fetch(`https://api.giphy.com/v1/gifs/${path}?${params}`, {
        signal: opts.signal,
    });
    if (!res.ok) throw new Error(await explainFailure("Giphy", res, "Giphy API key"));

    const body = await res.json().catch(() => null);
    const raw: GiphyItem[] = Array.isArray(body?.data) ? body.data : [];
    const items = raw.map(fromGiphy).filter((gif): gif is Gif => gif !== null);

    return { items, next: items.length >= limit ? String(offset + limit) : null };
}

// ---------------------------------------------------------------- Tenor

interface TenorFormat {
    url?: string;
    dims?: number[];
}

interface TenorItem {
    id?: string;
    content_rating?: string;
    content_description?: string;
    itemurl?: string;
    media_formats?: Record<string, TenorFormat>;
}

function fromTenor(item: TenorItem): Gif | null {
    const formats = item.media_formats ?? {};
    const full = formats.gif?.url ?? formats.mediumgif?.url ?? formats.tinygif?.url;
    if (!full) return null;
    const dims = formats.gif?.dims ?? formats.tinygif?.dims ?? [];
    return {
        url: full,
        preview: formats.tinygif?.url ?? formats.nanogif?.url ?? full,
        page: item.itemurl ?? full,
        title: item.content_description ?? "",
        width: Number(dims[0]) || 0,
        height: Number(dims[1]) || 0,
        provider: "tenor",
        nsfw: (item.content_rating ?? "").toUpperCase() === "R",
    };
}

async function searchTenor(
    query: string,
    cursor: string | null,
    limit: number,
    opts: SearchOptions,
): Promise<ProviderPage> {
    const key = (settings.store.tenorApiKey || "").trim() || DEFAULT_TENOR_KEY;

    const params = new URLSearchParams({
        key,
        limit: String(limit),
        client_key: "tenor_web",
        locale: "en_US",
        media_filter: "minimal,gif,tinygif",
        contentfilter: opts.nsfw ? "off" : "high",
    });
    if (query) params.set("q", query);
    if (cursor) params.set("pos", cursor);

    const path = query ? "search" : "featured";
    const res = await fetch(`https://tenor.googleapis.com/v2/${path}?${params}`, {
        signal: opts.signal,
    });
    if (!res.ok) throw new Error(await explainFailure("Tenor", res, "Tenor API key"));

    const body = await res.json().catch(() => null);
    const raw: TenorItem[] = Array.isArray(body?.results) ? body.results : [];
    const items = raw.map(fromTenor).filter((gif): gif is Gif => gif !== null);

    return { items, next: typeof body?.next === "string" && body.next ? body.next : null };
}

// ---------------------------------------------------------------- Discord

interface DiscordItem {
    id?: string;
    title?: string;
    url?: string;
    src?: string;
    gif_src?: string;
    preview?: string;
    width?: number;
    height?: number;
}

function fromDiscord(item: DiscordItem): Gif | null {
    const full = item.src ?? item.preview;
    if (!full) return null;
    return {
        url: full,
        preview: item.gif_src ?? item.preview ?? full,
        page: item.url ?? full,
        title: item.title ?? "",
        width: Number(item.width) || 0,
        height: Number(item.height) || 0,
        provider: "discord",
        nsfw: false,
    };
}

async function searchDiscord(
    query: string,
    cursor: string | null,
    limit: number,
    opts: SearchOptions,
): Promise<ProviderPage> {
    // The endpoint has no offset: "more" means asking the same query for a
    // bigger page, which is why the cursor here is a page size.
    const count = clamp(Number(cursor) || limit, DISCORD_MIN, DISCORD_MAX);

    const params = new URLSearchParams({
        limit: String(count),
        media_format: "gif",
        locale: "en-US",
    });
    if (query) params.set("q", query);

    const path = query ? "search" : "trending-gifs";
    const res = await fetch(`https://discord.com/api/v9/gifs/${path}?${params}`, {
        signal: opts.signal,
    });
    if (!res.ok) throw new Error(await explainFailure("Discord", res));

    const body = await res.json().catch(() => null);
    const raw: DiscordItem[] = Array.isArray(body) ? body : [];
    const items = raw.map(fromDiscord).filter((gif): gif is Gif => gif !== null);

    const grown = Math.min(DISCORD_MAX, count + DISCORD_STEP);
    return { items, next: items.length >= count && grown > count ? String(grown) : null };
}

const PROVIDERS: Provider[] = [
    { id: "giphy", label: "Giphy", enabled: () => settings.store.enableGiphy },
    { id: "tenor", label: "Tenor", enabled: () => settings.store.enableTenor },
    { id: "discord", label: "Discord", enabled: () => settings.store.enableDiscord },
];

const SEARCH: Record<
    ProviderId,
    (
        query: string,
        cursor: string | null,
        limit: number,
        opts: SearchOptions,
    ) => Promise<ProviderPage>
> = {
    giphy: searchGiphy,
    tenor: searchTenor,
    discord: searchDiscord,
};

function activeProviders() {
    return PROVIDERS.filter(p => p.enabled());
}

/** Round robin, so one provider cannot bury the others, and no duplicate URLs. */
function interleave(pages: Gif[][]): Gif[] {
    const seen = new Set<string>();
    const out: Gif[] = [];
    const longest = pages.reduce((n, list) => Math.max(n, list.length), 0);

    for (let i = 0; i < longest; i++) {
        for (const list of pages) {
            const gif = list[i];
            if (!gif || seen.has(gif.url)) continue;
            seen.add(gif.url);
            out.push(gif);
        }
    }
    return out;
}

interface RunOutcome {
    items: Gif[];
    errors: string[];
    cursors: Partial<Record<ProviderId, string | null>>;
}

async function runSearch(
    query: string,
    cursors: Partial<Record<ProviderId, string | null>>,
    nsfw: boolean,
    signal: AbortSignal,
): Promise<RunOutcome> {
    const limit = clamp(settings.store.resultsPerSource, 1, 50);
    const providers = activeProviders();
    if (!providers.length)
        throw new Error("Every GIF source is turned off. Enable at least one in plugin settings.");

    const trending = !query.trim();
    if (trending && !settings.store.trendingOnEmpty) return { items: [], errors: [], cursors };

    const settled = await Promise.allSettled(
        providers.map(provider =>
            SEARCH[provider.id](query.trim(), cursors[provider.id] ?? null, limit, {
                nsfw,
                signal,
            }),
        ),
    );

    const pages: Gif[][] = [];
    const errors: string[] = [];
    const nextCursors: Partial<Record<ProviderId, string | null>> = { ...cursors };

    settled.forEach((result, index) => {
        const provider = providers[index];
        if (result.status === "fulfilled") {
            pages.push(result.value.items);
            nextCursors[provider.id] = result.value.next;
        } else {
            const { reason } = result;
            if (reason?.name === "AbortError" || signal.aborted) return;
            errors.push(
                reason instanceof Error ? reason.message : `${provider.label}: ${String(reason)}`,
            );
        }
    });

    return { items: interleave(pages), errors, cursors: nextCursors };
}

function GifPickerModal({ modalProps, initialQuery }: { modalProps: any; initialQuery: string }) {
    const [query, setQuery] = React.useState(initialQuery);
    const [pending, setPending] = React.useState(false);
    const [results, setResults] = React.useState<Gif[]>([]);
    const [errors, setErrors] = React.useState<string[]>([]);
    const [nsfw, setNsfw] = React.useState<boolean>(() => !!settings.store.includeNsfw);
    const [searched, setSearched] = React.useState(false);
    const [hasMore, setHasMore] = React.useState(false);

    const inflight = React.useRef<AbortController | null>(null);
    const cursors = React.useRef<Partial<Record<ProviderId, string | null>>>({});

    const run = React.useCallback(
        async (q: string, mode: "replace" | "more", allowNsfw: boolean) => {
            inflight.current?.abort();
            const controller = new AbortController();
            inflight.current = controller;

            if (mode === "replace") cursors.current = {};
            const requested = mode === "more" ? { ...cursors.current } : {};

            setPending(true);
            setErrors([]);
            try {
                const outcome = await runSearch(q, requested, allowNsfw, controller.signal);
                if (controller.signal.aborted) return;
                cursors.current = outcome.cursors;
                setResults(prev =>
                    mode === "more" ? interleave([prev, outcome.items]) : outcome.items,
                );
                setErrors(outcome.errors);
                setHasMore(
                    Object.values(outcome.cursors).some(
                        cursor => cursor !== null && cursor !== undefined,
                    ),
                );
                setSearched(true);
            } catch (e) {
                if (controller.signal.aborted) return;
                setResults([]);
                setHasMore(false);
                setErrors([e instanceof Error ? e.message : String(e)]);
                setSearched(true);
            } finally {
                if (!controller.signal.aborted) setPending(false);
            }
        },
        [],
    );

    React.useEffect(() => {
        run(initialQuery, "replace", !!settings.store.includeNsfw);
        return () => inflight.current?.abort();
    }, []);

    const toggleNsfw = () => {
        const next = !nsfw;
        setNsfw(next);
        run(query, "replace", next);
    };

    const sources = activeProviders()
        .map(p => p.label)
        .join(", ");

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Search GIFs"
            actions={[
                {
                    text: nsfw ? "NSFW: on" : "NSFW: off",
                    variant: "secondary" as const,
                    onClick: toggleNsfw,
                },
                ...(hasMore
                    ? [
                          {
                              text: "Load more",
                              variant: "primary" as const,
                              onClick: () => run(query, "more", nsfw),
                          },
                      ]
                    : []),
                {
                    text: "Close",
                    variant: "secondary" as const,
                    onClick: () => modalProps.onClose(),
                },
            ]}
        >
            <input
                type="text"
                value={query}
                onChange={(e: any) => setQuery(e.target.value)}
                onKeyDown={(e: any) => {
                    if (e.key === "Enter") run(query, "replace", nsfw);
                }}
                placeholder={
                    settings.store.trendingOnEmpty
                        ? "Search GIFs, or press Enter for trending…"
                        : "Search GIFs…"
                }
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

            {pending && !results.length ? <div>Searching {sources}…</div> : null}

            {errors.length ? (
                <div style={{ marginBottom: 8, color: "var(--text-danger)", fontSize: 12 }}>
                    {errors.map((message, i) => (
                        <div key={i}>{message}</div>
                    ))}
                </div>
            ) : null}

            {!pending && searched && !results.length && !errors.length ? (
                <div>No GIFs came back. Try a different word.</div>
            ) : null}

            {!!results.length && (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                        gap: 8,
                    }}
                >
                    {results.map(gif => (
                        <div key={gif.url} style={{ position: "relative" }}>
                            <img
                                src={gif.preview}
                                title={`${gif.provider}${gif.nsfw ? " · NSFW" : ""} — ${gif.title || gif.page}`}
                                loading="lazy"
                                style={{
                                    width: "100%",
                                    aspectRatio: "1 / 1",
                                    objectFit: "cover",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    display: "block",
                                }}
                                onClick={() => {
                                    insertTextIntoChatInputBox(gif.url + " ");
                                    modalProps.onClose();
                                }}
                            />
                            {gif.nsfw && (
                                <span
                                    style={{
                                        position: "absolute",
                                        top: 4,
                                        right: 4,
                                        padding: "1px 4px",
                                        borderRadius: 3,
                                        fontSize: 10,
                                        lineHeight: "14px",
                                        background: "var(--status-danger)",
                                        color: "#fff",
                                    }}
                                >
                                    18+
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {pending && !!results.length ? <div style={{ marginTop: 8 }}>Loading more…</div> : null}
        </Modal>
    );
}

export default definePlugin({
    name: "GifSources",
    description:
        "Search GIFs across several sources with /gif and put one in the chat box. No API keys needed, and results are not filtered the way Discord's own picker filters them.",
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
