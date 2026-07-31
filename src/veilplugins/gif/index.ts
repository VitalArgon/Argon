import { definePlugin } from "@modules/plugin";
import { VeilDevs } from "@utils/contants"
import { registerCommand } from "@api/Commands";
import { ApplicationCommandOptionType } from "@api/Commands/types";

// Step 1: Fetch DuckDuckGo's temporary verification token for the search word
async function getVqdToken(searchTerm: string): Promise<string> {
    const response = await fetch(`https://duckduckgo.com{encodeURIComponent(searchTerm)}`);
    const htmlText = await response.text();
    
    const vqdMatch = htmlText.match(/vqd=["']([^"']+)["']/);
    if (!vqdMatch) {
        throw new Error("Could not extract security VQD token from DuckDuckGo.");
    }
    return vqdMatch[1];
}

// Step 2: Query the DDG image server with SafeSearch completely disabled (-2)
async function fetchUnfilteredGif(searchTerm: string): Promise<string> {
    try {
        const vqdToken = await getVqdToken(searchTerm);
        
        const url = new URL("https://duckduckgo.com");
        url.searchParams.append("q", searchTerm);
        url.searchParams.append("o", "json");
        url.searchParams.append("vqd", vqdToken);
        url.searchParams.append("p", "-2");
        url.searchParams.append("f", ",,,");

        const response = await fetch(url.toString());
        const data = await response.json();
        
        if (!data.results || data.results.length === 0) {
            return "❌ No GIFs found for that search query.";
        }

        // Filter and look for links that end with a .gif extension
        const gifs = data.results
            .map((item: any) => item.image)
            .filter((imgUrl: string) => imgUrl.toLowerCase().endsWith(".gif"));

        if (gifs.length === 0) {
            return "❌ No raw GIF files found in the results.";
        }

        // Return the very first valid GIF URL found
        return gifs[0];
    } catch (error) {
        console.error("Plugin Error:", error);
        return "❌ Error connecting to backend servers.";
    }
}

// Export the Vencord Plugin architecture
export default definePlugin({
    name: "Giffs",
    description: "Fetches gifs from duckduckgo",
    authors: [VeilDevs.Zarak],
    
    // Fires automatically when Discord client initializes
    start() {
        registerCommand({
            name: "giff",
            description: "Send an unfiltered GIF straight from the web",
            options: [
                {
                    name: "query",
                    description: "The term or keyword to search for",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            // This function processes your input strings
            async execute(args, ctx) {
                const searchWord = args[0].value;
                
                // Show a helpful visual status message that only you can see in chat
                ctx.channel.sendPlaceholder("Searching for your GIF...");

                const resultGifUrl = await fetchUnfilteredGif(searchWord);
                
                // Return the string directly to send it into the active channel text box
                return {
                    content: resultGifUrl
                };
            }
        });
    },
    
    stop() {
        // Automatically handled by Vencord client lifecycle
    }
});
