import GuildTheme from "./guildTheme";
import CustomChannelNames from "./customChannelNames";

export const GuildPlugins: Record<string, ReturnType<typeof import("./_api/defineGuildPlugin").defineGuildPlugin>> = {
    guildTheme: GuildTheme,
    customChannelNames: CustomChannelNames,
};
