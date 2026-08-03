import { GuildManifest } from "./guildplugins/manifest";
import { setUserOptIn, isUserOptedIn } from "./guildPluginManager";
import { GuildStore } from "@webpack/common";

export default function GuildPluginsSettings() {
    // only show guilds the user is actually currently in
    const relevantEntries = GuildManifest.filter(entry =>
        GuildStore.getGuild(entry.guildId) != null
    );

    if (relevantEntries.length === 0) {
        return <div>None of your servers have Guild Plugins available yet.</div>;
    }

    return (
        <div>
            {relevantEntries.map(entry => (
                <div key={entry.guildId} style={{ marginBottom: 16 }}>
                    <h3>{entry.guildName}</h3>
                    {entry.pluginIds.map(pluginId => (
                        <label key={pluginId} style={{ display: "flex", gap: 8 }}>
                            <input
                                type="checkbox"
                                defaultChecked={isUserOptedIn(entry.guildId, pluginId)}
                                onChange={e => setUserOptIn(entry.guildId, pluginId, e.target.checked)}
                            />
                            {pluginId}
                        </label>
                    ))}
                </div>
            ))}
        </div>
    );
}
