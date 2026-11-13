/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type ScrapeEngine = "duckduckgo" | "bing";

export interface ScrapeRequest {
    engine: ScrapeEngine;
    query: string;
    /** null on the first page, the cursor the previous page returned otherwise. */
    cursor: string | null;
    /** true asks the engine for unfiltered results (DDG p=-1, Bing adlt=off). */
    explicit: boolean;
    count: number;
}

export interface ScrapedGif {
    url: string;
    preview: string;
    title?: string;
    width?: number;
    height?: number;
    engine: ScrapeEngine;
}

export interface ScrapeResult {
    ok: boolean;
    results: ScrapedGif[];
    cursor: string | null;
    error?: string;
}

/** A result as the picker draws it, whatever produced it. */
export interface PickerGif {
    url: string;
    preview: string;
    title?: string;
    source: string;
}

/** Shape of one row of https://discord.com/api/v9/gifs/search. */
export interface DiscordGif {
    id: string;
    title?: string;
    src: string;
    gif_src?: string;
}
