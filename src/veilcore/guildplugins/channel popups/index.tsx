import { defineGuildPlugin } from "../_api/defineGuildPlugin";
import { VeilDevs } from "@utils/constants";
import { FluxDispatcher, ChannelStore, Button, Text } from "@webpack/common";
import { ModalRoot, ModalHeader, ModalContent, ModalFooter, openModal } from "@utils/modal";
import { PluginCard } from "@components/settings/tabs/plugins/PluginCard";
import { h, findPluginByName } from "@veilplugins/VeilCoreAPI";

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

    // same component the real Settings > Plugins tab renders — handles its
    // own enable/disable toggle, click-to-open-full-settings, everything
    return h(PluginCard, {
        plugin,
        disabled: plugin.required ?? false,
        onRestartNeeded: () => {},
    });
}

function showPopupModal(popup: ParsedPopup) {
    openModal(props => (
        <ModalRoot {...props}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">{popup.title}</Text>
            </ModalHeader>
            {(popup.text || popup.pluginId) && (
                <ModalContent>
                    {popup.text && <Text>{popup.text}</Text>}
                    {popup.pluginId && renderPluginCard(popup.pluginId)}
                </ModalContent>
            )}
            <ModalFooter>
                {popup.buttonText && popup.buttonLink && (
                    <Button onClick={() => window.open(popup.buttonLink, "_blank")}>
                        {popup.buttonText}
                    </Button>
                )}
                <Button color={Button.Colors.TRANSPARENT} onClick={props.onClose}>Close</Button>
            </ModalFooter>
        </ModalRoot>
    ));
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
    authors: [VeilDevs.Zarak],

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
