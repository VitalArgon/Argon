import { definePlugin } from "@modules/plugin";
import { VeilDevs } from "@utils/constants";
import { registerCommand } from "@api/Commands";
import { ApplicationCommandOptionType } from "@api/Commands/types";
import { Finder } from "@modules";

// Dynamically locate Discord's internal message routing engine
const MessageActions = Finder.byProps("sendBotMessage", "receiveMessage");

async function getVqdToken(searchTerm: string): Promise<string> {
    const response = await fetch(`https://duckduckgo.com{encodeURIComponent(searchTerm)}`);
    const htmlText = await response.text();
    
    const vqdMatch = htmlText.match(/vqd=["']([^"']+)["']/);
    if (!vqdMatch) throw new Error("VQD failed");
    return vqdMatch[1];
}

async function fetchUnfilteredGif(searchTerm: string): Promise<string> {
    try {
        const vqdToken = await getVqdToken(searchTerm);
        const url = new URL("https://duckduckgo.com");
        url.searchParams.append("q", searchTerm);
        url.searchParams.append("o", "json");
        url.searchParams.append("vqd", vqdToken);
        url.searchParams.append("p", "-2"); // Strict SafeSearch Off (-2)
        url.searchParams.append("f", ",,,");

        const response = await fetch(url.toString());
        const data = await response.json();
        
        if (!data.results || data.results.length === 0) return "❌ No GIFs found.";

        const gifs = data.results
            .map((item: any) => item.image)
            .filter((imgUrl: string) => imgUrl.toLowerCase().endsWith(".gif"));

        return gifs.length > 0 ? gifs[0] : "❌ No raw GIF files found.";
    } catch {
        return "❌ Network connectivity error.";
    }
}

export default definePlugin({
    name: "giff",
    description: "/giff, gets gif from duckduckgo",
    authors: [VeilDevs.Zarak],
    
    start() {
        registerCommand({
            name: "giff",
            description: "Send gifffff",
            options: [
                {
                    name: "query",
                    description: "The term or keyword to search for",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            async execute(args, { channel }) {
                const searchWord = args[0].value; // Grab search value cleanly
                
                // Fetch the GIF asynchronously in the background so Discord doesn't hang
                fetchUnfilteredGif(searchWord).then((gifUrl) => {
                    if (gifUrl.startsWith("❌")) {
                        // If it fails, print an ephemeral error message only you can see
                        MessageActions.receiveMessage(channel.id, {
                            id: "err-" + Date.now(),
                            content: gifUrl,
                            author: { id: "1", username: "Clyde", discriminator: "0000", avatar: "clyde" }
                        });
                    } else {
                        // Success: Drop the working raw URL directly into the text box stream
                        MessageActions.sendMessage(channel.id, { content: gifUrl });
                    }
                });

                // Instantly satisfies Discord's requirement for immediate execution
                return {};
            }
        });
    },
    stop() {}
});
