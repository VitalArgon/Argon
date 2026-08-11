/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { VeilDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByProps } from "@webpack";
import { subscribeFlux, createLogger } from "../ArgonCoreAPI";

import { banlist } from "./banlist";

const logger = createLogger("AntiBadWords", "#FF6B9D");

const settings = definePluginSettings({
    version: {
        type: OptionType.SELECT,
        description: "The version you want your message to render",
        options: [
            { label: "None", value: -1 },
            { label: "Roblox Version", value: 1 },
            { label: "Hard Version", value: 2 }
        ]
    }
});

// Shared utilities
const normalizeWord = (w: string) => w.replace(/[0l]/g, m => m === '0' ? 'o' : 'i');

let cachedPatterns: RegExp[] | null = null;

const buildPatterns = () => {
    if (cachedPatterns) return cachedPatterns;
    
    const clean = new Set<string>();
    for (const w of banlist) {
        clean.add(normalizeWord(w));
    }
    const cleanWords = Array.from(clean).sort((a, b) => b.length - a.length);
    cachedPatterns = cleanWords.map(w => 
        new RegExp(
            w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '\\w*?'), 
            'gi'
        )
    );
    return cachedPatterns;
};

const containsBadword = (text: string, patterns: RegExp[]): boolean => {
    const norm = normalizeWord(text);
    return patterns.some(re => {
        re.lastIndex = 0; // Reset regex state
        return re.test(norm);
    });
};

const REDACTION_STRATEGIES = {
    [1]: (e: any) => {
        const patterns = buildPatterns();
        if (e.type === "MESSAGE_CREATE" || e.type === "MESSAGE_UPDATE") {
            const parts = e.message.content.split(/([^a-zA-Z0-9]+)/);
            for (let i = 0; i < parts.length; i += 2) {
                if (containsBadword(parts[i], patterns)) {
                    parts[i] = "#".repeat(parts[i].length);
                }
            }
            e.message.content = parts.join("");
        }
    },
    [2]: (e: any) => {
        const patterns = buildPatterns();
        if (e.type === "MESSAGE_CREATE" || e.type === "MESSAGE_UPDATE") {
            if (containsBadword(e.message.content, patterns)) {
                e.message.content = `🔒 Message has been Redacted.\n-# Discord now requires ID verification in order to see certain messages. [Learn More](https://support.discord.com/hc/en-us/articles/18210995019671-Discord-Sensitive-Content-Filters)`;
            }
        }
    }
};

export default definePlugin({
    name: "AntiBadWords",
    author: [VeilDevs.Zarak],
    description: "Use Roblox chat filter directly in Discord!",
    dependencies: ["UserSettingsAPI", "VeilCoreAPI"],
    settings,
    start: () => {
        const unsubscribe = subscribeFlux("MESSAGE_CREATE", (e: any) => {
            const strategy = REDACTION_STRATEGIES[settings.store.version];
            if (strategy) {
                try {
                    strategy(e);
                } catch (err) {
                    logger.error("Error filtering message:", err);
                }
            }
        });

        // Also handle message updates if needed
        const unsubscribeUpdate = subscribeFlux("MESSAGE_UPDATE", (e: any) => {
            const strategy = REDACTION_STRATEGIES[settings.store.version];
            if (strategy) {
                try {
                    strategy(e);
                } catch (err) {
                    logger.error("Error filtering message update:", err);
                }
            }
        });

        return () => {
            unsubscribe();
            unsubscribeUpdate();
            cachedPatterns = null;
        };
    }
});
