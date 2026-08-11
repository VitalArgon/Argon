import { useEffect, useState, GuildStore } from "@webpack/common";
import { getEntryForGuild, GuildManifestEntry } from "./manifestSource";
import { setUserOptIn, isUserOptedIn } from "./guildPluginManager";

export default function GuildPluginsSettings() {
    const relevantEntries: GuildManifestEntry[] = Object.values(GuildStore.getGuilds())
        .map((guild: any) => getEntryForGuild(guild.id))
        .filter((entry): entry is GuildManifestEntry => entry != null);

    const [optIns, setOptIns] = useState<Record<string, boolean>>({});

    useEffect(() => {
        (async () => {
            const results: Record<string, boolean> = {};
            for (const entry of relevantEntries) {
                for (const pluginId of entry.pluginIds) {
                    results[`${entry.guildId}:${pluginId}`] = await isUserOptedIn(entry.guildId, pluginId);
                }
            }
            setOptIns(results);
        })();
    }, []);

    if (relevantEntries.length === 0) {
        return <div>None of your servers have Guild Plugins set up yet.</div>;
    }

    return (
        <div>
            {relevantEntries.map(entry => (
                <div key={entry.guildId} style={{ marginBottom: 16 }}>
                    <h3>{entry.guildName}</h3>
                    {entry.pluginIds.map(pluginId => {
                        const key = `${entry.guildId}:${pluginId}`;
                        return (
                            <label key={pluginId} style={{ display: "flex", gap: 8 }}>
                                <input
                                    type="checkbox"
                                    checked={optIns[key] ?? true}
                                    onChange={e => {
                                        setOptIns(prev => ({ ...prev, [key]: e.target.checked }));
                                        setUserOptIn(entry.guildId, pluginId, e.target.checked);
                                    }}
                                />
                                {pluginId}
                            </label>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
