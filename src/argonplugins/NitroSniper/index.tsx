/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { Message } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, UserStore } from "@webpack/common";

import { resolveGiftType } from "./giftCode";
import { settings } from "./settings";
import type { ClaimRequest, WebhookResult } from "./types";
import { sendClaimWebhook } from "./webhook";

const GIFT_LINK_REGEX = /(?:discord\.gift\/|discord\.com\/gifts?\/)([a-zA-Z0-9]{16,24})/;

const logger = new Logger("NitroSniper");
const GiftActions = findByPropsLazy("redeemGiftCode");

/** How long a redeem may stay silent before the queue moves on. */
const CLAIM_TIMEOUT_MS = 30_000;

let startTime = 0;
let claiming = false;
let claimTimer: ReturnType<typeof setTimeout> | undefined;
const claimQueue: ClaimRequest[] = [];
/** Codes already seen this session, so a duplicated message cannot be queued twice. */
const handledCodes = new Set<string>();

function resetState() {
    startTime = Date.now();
    claimQueue.length = 0;
    handledCodes.clear();
    claiming = false;
    stopClaimTimer();
}

function stopClaimTimer() {
    if (claimTimer !== undefined) {
        clearTimeout(claimTimer);
        claimTimer = undefined;
    }
}

function toError(error: unknown) {
    return error instanceof Error ? error : new Error(String(error));
}

function isOwnMessage(message: Message) {
    return message.author?.id === UserStore.getCurrentUser()?.id;
}

function shouldSkipMessage(message: Message) {
    return settings.store.ignoreOwnGiftLinks && isOwnMessage(message);
}

function isMessageOlderThanStart(message: Message) {
    return new Date(message.timestamp).getTime() < startTime;
}

function extractGiftCode(content: string) {
    return content.match(GIFT_LINK_REGEX)?.[1] ?? null;
}

function createClaimRequest(message: Message): ClaimRequest | null {
    const code = message.content ? extractGiftCode(message.content) : null;
    if (!code) return null;

    const authorId = message.author?.id;
    const authorAvatar = message.author?.avatar;

    return {
        code,
        authorId,
        authorName: message.author?.globalName ?? message.author?.username,
        authorUsername: message.author?.username,
        authorAvatarUrl: authorId && authorAvatar
            ? `https://cdn.discordapp.com/avatars/${authorId}/${authorAvatar}.png?size=128`
            : undefined,
        channelId: message.channel_id,
        guildId: ChannelStore.getChannel(message.channel_id)?.guild_id,
        messageId: message.id
    };
}

function notifyClaim(result: WebhookResult, request: ClaimRequest, giftType: string | null) {
    void sendClaimWebhook(
        settings.store.webhookUrl,
        result,
        request,
        giftType
    ).catch(webhookError => {
        logger.error("Failed to send NitroSniper webhook notification", webhookError);
    });
}

function continueQueue() {
    stopClaimTimer();
    claiming = false;
    processQueue();
}

function handleClaimSuccess(request: ClaimRequest, giftType: Promise<string | null>) {
    logger.log(`Successfully redeemed code: ${request.code}`);
    void giftType.then(type => notifyClaim("claimed", request, type));
    continueQueue();
}

function handleClaimFailure(request: ClaimRequest, error: Error, giftType: Promise<string | null>) {
    logger.error(`Failed to redeem code: ${request.code}`, error);
    void giftType.then(type => notifyClaim("failed", request, type));
    continueQueue();
}

function processQueue() {
    if (claiming) return;

    const request = claimQueue.shift();
    if (!request) return;

    claiming = true;

    // A code that never calls back would otherwise leave `claiming` stuck true
    // and kill the queue for the rest of the session.
    stopClaimTimer();
    claimTimer = setTimeout(() => {
        logger.warn(`No response after ${CLAIM_TIMEOUT_MS}ms for ${request.code}, moving on`);
        continueQueue();
    }, CLAIM_TIMEOUT_MS);

    const giftType = settings.store.webhookUrl.trim()
        ? resolveGiftType(request.code)
        : Promise.resolve(null);

    GiftActions.redeemGiftCode({
        code: request.code,
        onRedeemed: () => handleClaimSuccess(request, giftType),
        onError: (error: unknown) => handleClaimFailure(request, toError(error), giftType)
    });
}

export default definePlugin({
    name: "NitroSniper",
    description: "Automatically redeems Nitro gift links sent in chat",
    authors: [{
        name: "neoarz",
        id: 218675193592283137n
    }],
    tags: ["Chat", "Utility"],
    searchTerms: ["nitro", "gift", "redeem", "snipe"],
    settings,

    start() {
        resetState();
    },

    flux: {
        MESSAGE_CREATE({ message }: { message: Message; }) {
            if (!message.content || shouldSkipMessage(message) || isMessageOlderThanStart(message)) return;

            const request = createClaimRequest(message);
            if (!request || handledCodes.has(request.code)) return;

            handledCodes.add(request.code);
            claimQueue.push(request);
            processQueue();
        }
    }
});
