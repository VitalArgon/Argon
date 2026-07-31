import definePlugin from "@utils/types";
import { VeilDevs } from "@utils/constants";
import {
    ApplicationCommandInputType,
    ApplicationCommandOptionType,
    findOption
} from "@api/Commands";
import { sendMessage } from "@utils/discord";
import { findByPropsLazy } from "@webpack";

const MessageActions = findByPropsLazy("sendBotMessage", "receiveMessage");

const PROXY_BASE_URL = "https://giff-production.up.railway.app";

async function findGif(query: string): Promise<string | null> {
    const res = await fetch(`${PROXY_BASE_URL}/giff?q=${encodeURIComponent(query)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Proxy HTTP error ${res.status}`);
    const data = await res.json();
    return data.url ?? null;
}

export default definePlugin({
    name: "giff",
    description: "/giff <query> - fetch a GIF from DuckDuckGo via proxy",
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
                        content: "❌ You must provide a search query.",
                    });
                    return {};
                }

                try {
                    const gifUrl = await findGif(searchWord);
                    if (!gifUrl) {
                        MessageActions.sendBotMessage(channel.id, {
                            content: "❌ No GIFs found for that search.",
                        });
                    } else {
                        await sendMessage(channel.id, { content: gifUrl });
                    }
                } catch (error) {
                    MessageActions.sendBotMessage(channel.id, {
                        content: `❌ Search failed: ${String(error)}`,
                    });
                }
                return {};
            },
        },
    ],
});
