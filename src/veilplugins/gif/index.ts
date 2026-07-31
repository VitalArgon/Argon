import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    findOption
} from "@api/Commands";
import { sendMessage } from "@utils/discord";
import { findByPropsLazy } from "@webpack";

// sendBotMessage shows a local-only "Clyde" error message
const MessageActions = findByPropsLazy("sendBotMessage", "receiveMessage");

async function getVqdToken(searchTerm: string): Promise<string> {
    const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(searchTerm)}`);
    const html = await res.text();
    const match = html.match(/vqd='([\d-]+)'/) || html.match(/vqd="([\d-]+)"/) || html.match(/vqd=([\d-]+)/);
    if (!match) {
        throw new Error("Failed to extract VQD token from DuckDuckGo page");
    }
    return match[1];
}

async function fetchGif(searchTerm: string): Promise<string | null> {
    const vqd = await getVqdToken(searchTerm);
    const url = new URL("https://duckduckgo.com/i.js");
    url.searchParams.set("q", searchTerm);
    url.searchParams.set("vqd", vqd);
    url.searchParams.set("f", "");
    url.searchParams.set("p", "-2"); // Safe search on

    const res = await fetch(url.toString(), {
        headers: {
            "Referer": "https://duckduckgo.com/",
            "User-Agent": "Mozilla/5.0 (compatible)"
        }
    });

    if (!res.ok) {
        throw new Error(`DuckDuckGo image request failed with status ${res.status}`);
    }
    const data = await res.json();

    if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
        return null;
    }

    // Filter for GIFs only
    const gifEntry = data.results.find((item: any) =>
        typeof item.image === "string" && item.image.toLowerCase().endsWith(".gif")
    );

    return gifEntry ? gifEntry.image : null;
}

export default definePlugin({
    name: "giff",
    description: "/giff <query> — fetch a GIF from DuckDuckGo image search",
    authors: [VeilDevs.Zarak],
    dependencies: ["CommandsAPI"],

    commands: [
        {
            name: "giff",
            description: "Send a GIF matching a search term",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "query",
                    description: "The term or keyword to search for",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                },
            ],
            execute: async (opts, ctx) => {
                const searchWord = findOption(opts, "query", "").trim();
                const channel = ctx.channel;

                if (!searchWord) {
                    MessageActions.sendBotMessage(channel.id, {
                        content: "❌ You must provide a search query."
                    });
                    return {};
                }

                try {
                    const gifUrl = await fetchGif(searchWord);
                    if (!gifUrl) {
                        MessageActions.sendBotMessage(channel.id, {
                            content: "❌ No GIFs found for that search."
                        });
                    } else {
                        await sendMessage(channel.id, { content: gifUrl });
                    }
                } catch (error) {
                    MessageActions.sendBotMessage(channel.id, {
                        content: `❌ Search failed: ${String(error)}`
                    });
                }

                return {};
            },
        },
    ],
});
