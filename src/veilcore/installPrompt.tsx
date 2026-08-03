import * as DataStore from "@api/DataStore";
// ...
const askedKey = (guildId: string, pluginId: string) => `Veil_guildPlugin_asked_${guildId}_${pluginId}`;

export async function maybeShowInstallPrompt(entry: GuildManifestEntry, pluginId: string) {
    const key = askedKey(entry.guildId, pluginId);
    if (await DataStore.get(key) === true) return;

    openModal(props => (
        <ModalRoot {...props}>
            {/* ... */}
            <ModalFooter>
                <Button onClick={async () => {
                    await DataStore.set(key, true);
                    await setUserOptIn(entry.guildId, pluginId, true);
                    props.onClose();
                }}>Enable</Button>
                <Button color={Button.Colors.TRANSPARENT} onClick={async () => {
                    await DataStore.set(key, true);
                    props.onClose();
                }}>No thanks</Button>
            </ModalFooter>
        </ModalRoot>
    ));
}
