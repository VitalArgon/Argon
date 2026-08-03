export interface GuildManifestEntry {
    guildId: string;
    guildName: string;
    pluginIds: string[];
    promptOnJoin?: boolean;
}

export const StaticOverrides: GuildManifestEntry[] = [
    // { guildId: "123456789012345678", guildName: "My Test Server", pluginIds: ["welcomeBanner"] },
];
