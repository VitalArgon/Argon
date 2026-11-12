/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface GuildManifestEntry {
    guildId: string;
    guildName: string;
    pluginIds: string[];
    promptOnJoin?: boolean;
}

export const StaticOverrides: GuildManifestEntry[] = [
    // { guildId: "123456789012345678", guildName: "My Test Server", pluginIds: ["welcomeBanner"] },
];
