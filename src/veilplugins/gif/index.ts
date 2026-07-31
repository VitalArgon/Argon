import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";
import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption } from "@api/Commands";
import { sendMessage } from "@utils/discord";
import { findByPropsLazy } from "@webpack";

// sendBotMessage shows a local-only "Clyde" message — used for errors
// only. Actually sending the GIF uses Vencord's sendMessage wrapper
// below, not this — raw MessageActions.sendMessage requires a fully
// constructed message object (nonce, etc.) that isn't meant to be
// built by hand.
const MessageActions = findByPropsLazy("sendBotMessage", "receiveMessage");

// Set this to your deployed Railway URL, e.g. "https://giff-proxy-production.up.railway.app"
const PROXY_BASE_URL = "https://giff-production.up.railway.app";

async function findGif(query: string): Promise<string | null> {
    const res = await fetch(`${PROXY_BASE_URL}/giff?q=${encodeURIComponent(query)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    const data = await res.json();
    return data.url ?? null;
}

export default definePlugin({
    name: "giff",
    description: "/giff <query> — pulls a GIF from Openverse's public Creative Commons search API",
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
                        MessageActions.sendBotMessage(channel.id, {
                            content: "❌ No GIFs found for that search.",
                        });
                    } else {
                        sendMessage(channel.id, { content: gifUrl });
                    }
                }).catch(err => {
                    MessageActions.sendBotMessage(channel.id, {
                        content: `❌ Search failed: ${String(err)}`,
                    });
                });
            },
        },
    ],
});
