import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { findByPropsLazy } from "@webpack";

// Dynamically locate Discord's internal message routing engine
const MessageActions = findByPropsLazy("sendBotMessage", "receiveMessage");

// Set this to your deployed Railway URL, e.g. "https://giff-proxy-production.up.railway.app"
const PROXY_BASE_URL = "http://giff-production.up.railway.app";

async function findGif(query: string): Promise<string | null> {
    const res = await fetch(`${PROXY_BASE_URL}/giff?q=${encodeURIComponent(query)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    const data = await res.json();
    return data.url ?? null;
}

export default definePlugin({
    name: "giff",
    description: "/giff <query> — pulls a GIF from curated SFW subreddits via Reddit's public search API",
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
                const searchWord = findOption(opts, "query", "");
                const channel = ctx.channel;

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
            },
        },
    ],
});
