import { getEntryForGuild, GuildManifestEntry } from "./manifestSource";
import { setUserOptIn, isUserOptedIn } from "./guildPluginManager";
import { GuildStore } from "@webpack/common";

export default function GuildPluginsSettings() {
    // check every guild the user is currently in — there's no fixed list
    // anymore, so this has to actually probe each one for a #veil-plugins
    // config rather than filtering a static array
    const relevantEntries: GuildManifestEntry[] = Object.values(GuildStore.getGuilds())
        .map((guild: any) => getEntryForGuild(guild.id))
        .filter((entry): entry is GuildManifestEntry => entry != null);

    if (relevantEntries.length === 0) {
        return <div>None of your servers have Guild Plugins set up yet.</div>;
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
