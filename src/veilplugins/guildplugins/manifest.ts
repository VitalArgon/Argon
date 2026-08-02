export interface GuildManifestEntry {
    guildId: string;
    guildName: string;         // just for your own readability / popup text
    pluginIds: string[];       // which guild plugin(s) unlock in this guild
    promptOnJoin?: boolean;    // show the opt-in popup when user lands here
}

export const GuildManifest: GuildManifestEntry[] = [
    {
        guildId: "123456789012345678",
        guildName: "My Test Server",
        pluginIds: ["welcomeBanner", "customChannelNames"],
        promptOnJoin: true,
    },
];
