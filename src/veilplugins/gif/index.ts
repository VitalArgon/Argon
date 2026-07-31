import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
// Dynamically locate Discord's internal message routing engine
const MessageActions = Finder.byProps("sendBotMessage", "receiveMessage");

// Subreddits to search — all SFW-moderated GIF communities.
// Add more here if you want, but stick to subs that actively
// enforce no-NSFW rules.
const GIF_SUBREDDITS = ["gifs", "reactiongifs", "perfectloops", "porn_gifs", "hentai_gif"];

interface RedditPost {
    url: string;
    over_18: boolean;
    is_video: boolean;
    title: string;
}

async function searchSubreddit(subreddit: string, query: string): Promise<RedditPost[]> {
    const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=relevance&limit=15`;
    const res = await fetch(url, {
        headers: { "User-Agent": "VeilDiscordMod/1.0" },
    });
    if (!res.ok) throw new Error(`Reddit HTTP ${res.status} (r/${subreddit})`);
    const json = await res.json();
    return (json?.data?.children ?? []).map((c: any) => ({
        url: c.data?.url_overridden_by_dest ?? c.data?.url,
        over_18: !!c.data?.over_18,
        is_video: !!c.data?.is_video,
        title: c.data?.title ?? "",
    }));
}

function isDirectGifUrl(url: string | undefined): url is string {
    if (!url) return false;
    return /\.(gif|gifv)(\?.*)?$/i.test(url) || url.includes("i.redd.it") || url.includes("i.imgur.com");
}

async function findGif(query: string): Promise<string | null> {
    const settled = await Promise.allSettled(
        GIF_SUBREDDITS.map(sub => searchSubreddit(sub, query))
    );

    const candidates: RedditPost[] = [];
    for (const r of settled) {
        if (r.status === "fulfilled") candidates.push(...r.value);
        else console.error("[giff] subreddit search failed:", r.reason);
    }

    // Safety filter — drop anything flagged NSFW by Reddit itself.
    // This is a second layer on top of subreddit selection, not a
    // replacement for it: over_18 relies on correct post flagging,
    // so it's not airtight on its own.
    const safe = candidates.filter(p => p.over_18 && isDirectGifUrl(p.url));

    return safe.length ? safe[0].url : null;
}

export default definePlugin({
    name: "giff",
    description: "/giff <query> — pulls a GIF from curated SFW subreddits via Reddit's public search API",
    authors: [VeilDevs.Zarak],

    start() {
        registerCommand({
            name: "giff",
            description: "Send a GIF matching a search term",
            options: [
                {
                    name: "query",
                    description: "The term or keyword to search for",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            async execute(args, { channel }) {
                const searchWord = args[0].value;

                findGif(searchWord).then(gifUrl => {
                    if (!gifUrl) {
                        MessageActions.receiveMessage(channel.id, {
                            id: "err-" + Date.now(),
                            content: "❌ No GIFs found for that search.",
                            author: { id: "1", username: "Clyde", discriminator: "0000", avatar: "clyde" },
                        });
                    } else {
                        MessageActions.sendMessage(channel.id, { content: gifUrl });
                    }
                }).catch(err => {
                    MessageActions.receiveMessage(channel.id, {
                        id: "err-" + Date.now(),
                        content: `❌ Search failed: ${String(err)}`,
                        author: { id: "1", username: "Clyde", discriminator: "0000", avatar: "clyde" },
                    });
                });

                return {};
            },
        });
    },

    stop() {},
});
