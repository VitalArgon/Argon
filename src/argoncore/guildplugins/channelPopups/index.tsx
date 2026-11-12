/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PluginCard } from "@components/settings/tabs/plugins/PluginCard";
import { Text } from "@components/Text";
import { ArgonDevs } from "@utils/constants";
import { ChannelStore, FluxDispatcher, Modal, openModal } from "@webpack/common";

import { findPluginByName } from "../../../argonplugins/ArgonCoreAPI";
import { defineGuildPlugin } from "../_api/defineGuildPlugin";

interface ParsedPopup {
    title: string;
    text?: string;
    buttonText?: string;
    buttonLink?: string;
    pluginId?: string;
}

const TAG_PATTERN = /\{\{\s*(popuptitle|popuptext|popupbutton|popupplugin)\s*:\s*([\s\S]*?)\s*\}\}/gi;

function parsePopup(topic: string | undefined | null): ParsedPopup | null {
    if (!topic) return null;

    const fields: Record<string, string> = {};
    let match: RegExpExecArray | null;
    TAG_PATTERN.lastIndex = 0;
    while ((match = TAG_PATTERN.exec(topic)) !== null) {
        fields[match[1].toLowerCase()] = match[2].trim();
    }

    if (!fields.popuptitle) return null;

    const popup: ParsedPopup = { title: fields.popuptitle };
    if (fields.popuptext) popup.text = fields.popuptext;

    if (fields.popupbutton) {
        const [btnText, btnLink] = fields.popupbutton.split("|").map(s => s.trim());
        if (btnText && btnLink) {
            popup.buttonText = btnText;
            popup.buttonLink = btnLink;
        }
    }

    if (fields.popupplugin) popup.pluginId = fields.popupplugin;

    return popup;
}

function renderPluginCard(pluginId: string) {
    const plugin = findPluginByName(pluginId);
    if (!plugin) {
        return <Text color="text-danger">Unknown plugin id in popup: {pluginId}</Text>;
    }

    return (
        <PluginCard
            plugin={plugin}
            disabled={plugin.required ?? false}
            onRestartNeeded={() => {}}
        />
    );
}

function showPopupModal(popup: ParsedPopup) {
    openModal(props => {
        const actions: { text: string; variant: "primary" | "secondary"; onClick: () => void; }[] = [];

        if (popup.buttonText && popup.buttonLink) {
            const { buttonLink } = popup;
            actions.push({
                text: popup.buttonText,
                variant: "primary",
                onClick: () => window.open(buttonLink, "_blank"),
            });
        }

        actions.push({ text: "Close", variant: "secondary", onClick: props.onClose });

        return (
            <Modal
                {...props}
                title={popup.title}
                actions={actions}
            >
                {popup.text && <Text>{popup.text}</Text>}
                {popup.pluginId && renderPluginCard(popup.pluginId)}
            </Modal>
        );
    });
}

const shownThisSession = new Set<string>();
let watchedGuildId: string | null = null;

function onChannelSelect({ channelId }: any) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || channel.guild_id !== watchedGuildId) return;
    if (shownThisSession.has(channelId)) return;

    const popup = parsePopup(channel.topic);
    if (!popup) return;

    shownThisSession.add(channelId);
    showPopupModal(popup);
}

export default defineGuildPlugin({
    name: "ChannelPopups",
    description: "Shows a custom popup defined in a channel's description, the first time you open that channel each session.",
    authors: [ArgonDevs.Zarak],

    start(guildId?: string) {
        watchedGuildId = guildId ?? null;
        FluxDispatcher.subscribe("CHANNEL_SELECT", onChannelSelect);
    },

    stop() {
        FluxDispatcher.unsubscribe("CHANNEL_SELECT", onChannelSelect);
        watchedGuildId = null;
        shownThisSession.clear();
    },
});
