/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent } from "electron";

import type { ScrapedGif, ScrapeRequest, ScrapeResult } from "./types";

/*
 * This file runs in Electron's main process, so the requests below are not
 * subject to CORS. That is the whole reason it exists: neither Google, Bing nor
 * DuckDuckGo sends an Access-Control-Allow-Origin header on their result pages,
 * so a fetch from the renderer is refused before the body is readable.
 */

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const VQD_TTL_MS = 10 * 60 * 1000;
const vqdCache = new Map<string, { vqd: string; at: number; }>();

function fail(error: string): ScrapeResult {
    return { ok: false, results: [], cursor: null, error };
}

function describeStatus(status: number): string {
    if (status === 429) return "the search engine is rate limiting this machine, wait a few seconds and try again";
    if (status === 403) return "the search engine refused the request with 403; DuckDuckGo rate limits quickly, so wait a moment or switch the engine to Bing";
    if (status === 404) return "the search endpoint moved and answered 404";
    if (status >= 500) return `the search engine answered ${status}`;
    return `the search engine answered ${status}`;
}

function decodeEntities(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

async function request(url: string, referer?: string): Promise<{ status: number; body: string; }> {
    const response = await fetch(url, {
        headers: {
            "user-agent": USER_AGENT,
            "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
            ...(referer ? { referer } : {}),
        },
    });

    return { status: response.status, body: await response.text() };
}

/** Keep only real GIFs when the page has any, otherwise keep everything. */
function preferGifs(items: ScrapedGif[], count: number): ScrapedGif[] {
    const gifs = items.filter(item => /\.gif(?:$|\?)/i.test(item.url) || /media\d*\.tenor\.com|static\.klipy\.com/i.test(item.url));
    const chosen = gifs.length ? gifs : items;
    return chosen.slice(0, count);
}

async function duckDuckGoToken(query: string, explicit: boolean): Promise<string | null> {
    const cacheKey = `${explicit ? "x" : "s"}:${query}`;
    const cached = vqdCache.get(cacheKey);
    if (cached && Date.now() - cached.at < VQD_TTL_MS) return cached.vqd;

    const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images&kp=${explicit ? "-1" : "1"}`;
    const { body } = await request(url);

    const match = body.match(/vqd=["']?([\d-]+)/);
    if (!match) return null;

    vqdCache.set(cacheKey, { vqd: match[1], at: Date.now() });
    return match[1];
}

async function scrapeDuckDuckGo(req: ScrapeRequest): Promise<ScrapeResult> {
    /* DuckDuckGo has no animated-only filter, so the word is added to the query the
       way a person would. Bing has a real filter and is the default engine. */
    const query = /\bgif\b/i.test(req.query) ? req.query : `${req.query} gif`;
    const token = await duckDuckGoToken(query, req.explicit);
    if (!token) return fail("DuckDuckGo did not hand out a search token. Try again, or set the engine to Bing.");

    const url = req.cursor
        ? (req.cursor.startsWith("http") ? req.cursor : `https://duckduckgo.com/${req.cursor.replace(/^\//, "")}`)
        : "https://duckduckgo.com/i.js"
            + "?l=us-en&o=json"
            + `&q=${encodeURIComponent(query)}`
            + `&vqd=${token}`
            + "&f=,,,"
            + `&p=${req.explicit ? "-1" : "1"}`;

    const { status, body } = await request(url, "https://duckduckgo.com/");
    if (status !== 200) return fail(describeStatus(status));

    let parsed: any;
    try {
        parsed = JSON.parse(body);
    } catch {
        return fail("DuckDuckGo answered with something that was not JSON, which usually means it served a captcha.");
    }

    const raw: any[] = Array.isArray(parsed?.results) ? parsed.results : [];
    const items: ScrapedGif[] = raw
        .filter(item => typeof item?.image === "string")
        .map(item => ({
            url: item.image,
            preview: typeof item.thumbnail === "string" ? item.thumbnail : item.image,
            title: typeof item.title === "string" ? item.title : undefined,
            width: typeof item.width === "number" ? item.width : undefined,
            height: typeof item.height === "number" ? item.height : undefined,
            engine: "duckduckgo" as const,
        }));

    if (!items.length) return { ok: true, results: [], cursor: null, error: "DuckDuckGo had no results for that." };

    return {
        ok: true,
        results: preferGifs(items, req.count),
        cursor: typeof parsed?.next === "string" ? parsed.next : null,
    };
}

async function scrapeBing(req: ScrapeRequest): Promise<ScrapeResult> {
    const first = Number(req.cursor) || 0;
    const pageSize = 35;
    const url = "https://www.bing.com/images/async"
        + `?q=${encodeURIComponent(req.query)}`
        + `&first=${first}`
        + `&count=${pageSize}`
        + "&mmasync=1"
        + "&qft=+filterui:photo-animatedgif"
        + `&adlt=${req.explicit ? "off" : "strict"}`;

    const { status, body } = await request(url, "https://www.bing.com/images/search");
    if (status !== 200) return fail(describeStatus(status));
    if (body.length < 2000) return fail("Bing answered with an empty page, which usually means it wants a captcha. Try again, or set the engine to DuckDuckGo.");

    const urls: string[] = [];
    const previews: string[] = [];

    const urlPattern = /murl&quot;:&quot;(.+?)&quot;/g;
    let match: RegExpExecArray | null;
    while ((match = urlPattern.exec(body)) !== null) urls.push(decodeEntities(match[1]));

    const previewPattern = /turl&quot;:&quot;(.+?)&quot;/g;
    while ((match = previewPattern.exec(body)) !== null) previews.push(decodeEntities(match[1]));

    const items: ScrapedGif[] = urls
        .filter(u => u.startsWith("http"))
        .map((u, index) => ({
            url: u,
            preview: previews[index] ?? u,
            engine: "bing" as const,
        }));

    if (!items.length) return { ok: true, results: [], cursor: null, error: "Bing had no results for that." };

    const gifs = preferGifs(items, req.count);

    return {
        ok: true,
        results: gifs,
        cursor: urls.length >= pageSize ? String(first + pageSize) : null,
    };
}

/**
 * Scrape one page of image results. Called from the renderer through
 * VencordNative.pluginHelpers.GifSources, so the first argument is injected.
 */
export async function search(_: IpcMainInvokeEvent, req: ScrapeRequest): Promise<ScrapeResult> {
    try {
        if (!req?.query?.trim()) return fail("Nothing to search for.");

        const query = req.query.trim();
        const normalised: ScrapeRequest = { ...req, query };

        return req.engine === "bing"
            ? await scrapeBing(normalised)
            : await scrapeDuckDuckGo(normalised);
    } catch (error) {
        return fail(error instanceof Error ? error.message : String(error));
    }
}
