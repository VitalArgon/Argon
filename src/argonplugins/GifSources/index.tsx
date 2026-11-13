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
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { Modal, openModal, React } from "@webpack/common";

import type { PickerGif, ScrapeEngine, ScrapeRequest, ScrapeResult } from "./types";

/*
 * Scraping has to happen in the main process: Google, Bing and DuckDuckGo all
 * omit Access-Control-Allow-Origin, so the renderer cannot read their result
 * pages. VencordNative exists only in the desktop app, which is why there is a
 * second, filtered source for the browser build.
 */
const Native: PluginNative<typeof import("./native")> | null = (() => {
    try {
        if (typeof VencordNative === "undefined") return null;
        const helper = (VencordNative as any)?.pluginHelpers?.GifSources;
        return helper ?? null;
    } catch {
        return null;
    }
})();

const DISCORD_PAGE_SIZE = 20;

const settings = definePluginSettings({
    engine: {
        type: OptionType.SELECT,
        description:
            "Which search engine to scrape. Google serves its image results only through JavaScript now, so its HTML carries no image URLs to read; Bing still returns them, with a real animated-GIF filter, and DuckDuckGo works but rate limits fast.",
        options: [
            { label: "Bing (animated-GIF filter)", value: "bing", default: true },
            { label: "DuckDuckGo", value: "duckduckgo" },
        ],
    },
    includeExplicit: {
        type: OptionType.BOOLEAN,
        description:
            "Ask the engine for unfiltered results (DuckDuckGo p=-1, Bing adlt=off). The button in the picker switches it for one search.",
        default: true,
    },
    resultsPerPage: {
        type: OptionType.NUMBER,
        description: "How many results to keep per page",
        default: 40,
    },
});

function sourceLabel(source: string): string {
    if (source === "duckduckgo") return "DuckDuckGo";
    if (source === "bing") return "Bing";
    return "Discord";
}

async function searchScraped(
    query: string,
    explicit: boolean,
    cursor: string | null,
): Promise<{ items: PickerGif[]; cursor: string | null; }> {
    if (!Native) throw new Error("Scraping needs the desktop app.");

    const request: ScrapeRequest = {
        engine: settings.store.engine as ScrapeEngine,
        query,
        cursor,
        explicit,
        count: Math.max(1, Math.min(100, settings.store.resultsPerPage)),
    };

    const result: ScrapeResult = await Native.search(request);
    if (!result.ok) throw new Error(result.error ?? "The search failed.");

    return {
        items: result.results.map(item => ({
            url: item.url,
            preview: item.preview,
            title: item.title,
            source: item.engine,
        })),
        cursor: result.cursor,
    };
}

async function searchDiscord(query: string, signal: AbortSignal): Promise<PickerGif[]> {
    const url = query
        ? `https://discord.com/api/v9/gifs/search?q=${encodeURIComponent(query)}&limit=${DISCORD_PAGE_SIZE}&media_format=gif`
        : `https://discord.com/api/v9/gifs/trending-gifs?limit=${DISCORD_PAGE_SIZE}&media_format=gif`;

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Discord's GIF service answered ${response.status}.`);

    const data: any = await response.json();
    const rows: any[] = Array.isArray(data) ? data : [];

    return rows
        .filter(row => typeof row?.src === "string")
        .map(row => ({
            url: row.src as string,
            preview: (typeof row.gif_src === "string" ? row.gif_src : row.src) as string,
            title: typeof row.title === "string" ? row.title : undefined,
            source: "discord",
        }));
}

function Tile({ gif, onPick }: { gif: PickerGif; onPick: (url: string) => void; }) {
    const [broken, setBroken] = React.useState(false);
    if (broken) return null;

    return (
        <button
            type="button"
            title={gif.title ? `${gif.title} (${sourceLabel(gif.source)})` : sourceLabel(gif.source)}
            onClick={() => onPick(gif.url)}
            style={{
                width: 156,
                height: 112,
                padding: 0,
                border: "1px solid var(--background-modifier-accent)",
                borderRadius: 6,
                overflow: "hidden",
                cursor: "pointer",
                background: "var(--background-secondary-alt)",
            }}
        >
            <img
                src={gif.preview}
                alt={gif.title ?? "GIF result"}
                loading="lazy"
                onError={() => setBroken(true)}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
        </button>
    );
}

function GifPickerModal({ modalProps, initialQuery }: { modalProps: any; initialQuery: string; }) {
    const [query, setQuery] = React.useState(initialQuery);
    const [items, setItems] = React.useState<PickerGif[]>([]);
    const [error, setError] = React.useState<string | null>(null);
    const [pending, setPending] = React.useState(false);
    const [searched, setSearched] = React.useState(false);
    const [explicit, setExplicit] = React.useState<boolean>(() => !!settings.store.includeExplicit);
    const [more, setMore] = React.useState(false);

    const cursor = React.useRef<string | null>(null);
    const inflight = React.useRef<AbortController | null>(null);

    const run = React.useCallback(
        async (term: string, mode: "replace" | "more", allowExplicit: boolean) => {
            inflight.current?.abort();
            const controller = new AbortController();
            inflight.current = controller;

            setPending(true);
            setError(null);

            try {
                const trimmed = term.trim();

                if (!Native) {
                    const found = await searchDiscord(trimmed, controller.signal);
                    if (controller.signal.aborted) return;
                    setItems(found);
                    setSearched(true);
                    return;
                }

                const page = await searchScraped(
                    trimmed,
                    allowExplicit,
                    mode === "more" ? cursor.current : null,
                );
                if (controller.signal.aborted) return;

                cursor.current = page.cursor;
                setMore(page.cursor !== null);
                setItems(previous => (mode === "more" ? [...previous, ...page.items] : page.items));
                setSearched(true);
            } catch (thrown) {
                if (controller.signal.aborted) return;
                if ((thrown as Error)?.name === "AbortError") return;
                setError(thrown instanceof Error ? thrown.message : String(thrown));
            } finally {
                if (!controller.signal.aborted) setPending(false);
            }
        },
        [],
    );

    React.useEffect(() => {
        if (initialQuery.trim() || !Native) void run(initialQuery, "replace", explicit);
    }, []);

    const toggleExplicit = () => {
        const next = !explicit;
        setExplicit(next);
        if (searched || query.trim()) {
            cursor.current = null;
            void run(query, "replace", next);
        }
    };

    const pick = (url: string) => {
        insertTextIntoChatInputBox(url);
        modalProps.onClose();
    };

    return (
        <Modal
            {...modalProps}
            size="lg"
            title="Search GIFs"
            actions={[
                {
                    text: explicit ? "Explicit: on" : "Explicit: off",
                    variant: "secondary" as const,
                    onClick: toggleExplicit,
                },
                ...(more
                    ? [{
                        text: pending ? "Loading…" : "Load more",
                        variant: "primary" as const,
                        disabled: pending,
                        onClick: () => void run(query, "more", explicit),
                    }]
                    : []),
            ]}
        >
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                    autoFocus
                    value={query}
                    placeholder={Native ? "Search, or leave empty for trending" : "Search Discord's GIF service"}
                    onChange={event => setQuery(event.currentTarget.value)}
                    onKeyDown={event => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        cursor.current = null;
                        void run(query, "replace", explicit);
                    }}
                    style={{
                        flex: 1,
                        padding: "8px 10px",
                        borderRadius: 4,
                        border: "1px solid var(--background-modifier-accent)",
                        background: "var(--background-secondary-alt)",
                        color: "var(--text-normal)",
                    }}
                />
                <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                        cursor.current = null;
                        void run(query, "replace", explicit);
                    }}
                    style={{
                        padding: "0 14px",
                        borderRadius: 4,
                        cursor: pending ? "default" : "pointer",
                        background: "var(--brand-500)",
                        color: "#fff",
                        border: "none",
                        fontWeight: 500,
                    }}
                >
                    {pending ? "Searching…" : "Search"}
                </button>
            </div>

            {!Native && (
                <div style={{ marginBottom: 8, color: "var(--text-muted)", fontSize: 12 }}>
                    Browser build: scraping needs the desktop app, so this falls back to Discord's own GIF
                    service, which filters explicit results.
                </div>
            )}

            {error && (
                <div style={{ marginBottom: 8, color: "var(--text-danger)", fontSize: 13 }}>{error}</div>
            )}

            {!error && searched && !items.length && !pending && (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No GIFs for that.</div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 420, overflowY: "auto" }}>
                {items.map(gif => (
                    <Tile key={`${gif.source}:${gif.url}`} gif={gif} onPick={pick} />
                ))}
            </div>
        </Modal>
    );
}

export default definePlugin({
    name: "GifSources",
    description:
        "Search GIFs with /gif and put one in the chat box. Scrapes DuckDuckGo or Bing with no API key and asks for unfiltered results.",
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
                openModal(modalProps => (
                    <GifPickerModal modalProps={modalProps} initialQuery={query ?? ""} />
                ));
            },
        },
    ],
});
