import GuildTheme from "./guildTheme";
import CustomChannelNames from "./customChannelNames";
import ChannelPopups from "./channelPopups";
import CategoryBanners from "./categoryBanners";

export const GuildPlugins: Record<string, ReturnType<typeof import("./_api/defineGuildPlugin").defineGuildPlugin>> = {
    guildTheme: GuildTheme,
    customChannelNames: CustomChannelNames,
    channelPopups: ChannelPopups,
    categoryBanners: CategoryBanners,
};
