/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    MessageSendListener,
} from "@api/MessageEvents";
import {
    definePluginSettings,
} from "@api/Settings";
import { ArgonDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";

const presendObject: MessageSendListener = (channelId, msg) => {
    msg.content = textProcessing(msg.content);
};

const settings = definePluginSettings({
    quickDisable: {
        type: OptionType.BOOLEAN,
        description: "Quick disable. Turns off abbreviation expansion without requiring a client reload.",
        default: false,
    },
    caseSensitive: {
        type: OptionType.BOOLEAN,
        description: "Only match abbreviations with exact casing (e.g. 'ig' won't match 'IG').",
        default: false,
    },
    matchCapitalization: {
        type: OptionType.BOOLEAN,
        description: "If the abbreviation you typed was capitalized, capitalize the first letter of the replacement too.",
        default: true,
    },
    abbreviations: {
        type: OptionType.STRING,
        description: "Abbreviation pairs. Format: ig=I guess, idk=I don't know (comma separated, one 'abbr=expansion' per entry).",
        default: "ig=I guess, idk=I don't know, brb=be right back, imo=in my opinion",
    },
});

export default definePlugin({
    name: "AbbreviationExpander",
    description: "Automatically expands custom abbreviations/shorthand as you type them into messages. Configure pairs in settings.",
    dependencies: ["MessageEventsAPI"],
    tags: ["Chat", "Argon"],
    authors: [ArgonDevs.Zarak],
    onBeforeMessageSend: presendObject,
    settings,
});

function parseAbbreviations(raw: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!raw) return map;

    const entries = raw.split(",");

    for (const entry of entries) {
        const eqIndex = entry.indexOf("=");
        if (eqIndex === -1) continue;

        const abbr = entry.slice(0, eqIndex).trim();
        const expansion = entry.slice(eqIndex + 1).trim();

        if (!abbr || !expansion) continue;

        map.set(settings.store.caseSensitive ? abbr : abbr.toLowerCase(), expansion);
    }

    return map;
}

function applyCapitalization(original: string, expansion: string): string {
    if (!settings.store.matchCapitalization) return expansion;

    const firstChar = original[0];
    if (!firstChar) return expansion;

    if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
        return expansion.charAt(0).toUpperCase() + expansion.slice(1);
    }

    return expansion;
}

function textProcessing(input: string): string {
    // Quick disable, without having to reload the client
    if (settings.store.quickDisable) return input;

    let text = input;

    // Preserve code blocks so we never mangle code the user is sending
    const codeBlockRegex = /```[\s\S]*?```|`[\s\S]*?`/g;
    const codeBlocks: string[] = [];
    text = text.replace(codeBlockRegex, match => {
        codeBlocks.push(match);
        return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
    });

    const abbreviationMap = parseAbbreviations(settings.store.abbreviations);

    if (abbreviationMap.size > 0) {
        const keys = Array.from(abbreviationMap.keys()).map(escapeRegex);
        const flags = settings.store.caseSensitive ? "g" : "gi";
        const regex = new RegExp(`\\b(${keys.join("|")})\\b`, flags);

        text = text.replace(regex, match => {
            const lookupKey = settings.store.caseSensitive ? match : match.toLowerCase();
            const expansion = abbreviationMap.get(lookupKey);
            if (expansion === undefined) return match;

            return applyCapitalization(match, expansion);
        });
    }

    text = text.replace(/__CODE_BLOCK_(\d+)__/g, (_, index) => codeBlocks[parseInt(index)]);

    return text;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
