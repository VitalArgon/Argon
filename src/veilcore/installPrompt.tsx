import { ModalRoot, ModalHeader, ModalContent, ModalFooter, openModal } from "@utils/modal";
import { Button, Text } from "@webpack/common";
import { GuildManifestEntry } from "@veilplugins/guildplugins/manifest";
import { setUserOptIn } from "./guildPluginManager";

const askedKey = (guildId: string, pluginId: string) => `Veil_guildPlugin_asked_${guildId}_${pluginId}`;

export function maybeShowInstallPrompt(entry: GuildManifestEntry, pluginId: string) {
    const key = askedKey(entry.guildId, pluginId);
    if (localStorage.getItem(key) === "true") return;

    openModal(props => (
        <ModalRoot {...props}>
            <ModalHeader>
                <Text variant="heading-lg/semibold">{entry.guildName} has a plugin for you</Text>
            </ModalHeader>
            <ModalContent>
                <Text>This server offers the "{pluginId}" plugin. Enable it for this server only?</Text>
            </ModalContent>
            <ModalFooter>
                <Button onClick={() => {
                    localStorage.setItem(key, "true");
                    setUserOptIn(entry.guildId, pluginId, true);
                    props.onClose();
                }}>Enable</Button>
                <Button color={Button.Colors.TRANSPARENT} onClick={() => {
                    localStorage.setItem(key, "true");
                    props.onClose();
                }}>No thanks</Button>
            </ModalFooter>
        </ModalRoot>
    ));
}
