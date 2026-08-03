import WelcomeBanner from "./welcomeBanner";
import CustomChannelNames from "./customChannelNames";

export const GuildPlugins: Record<string, ReturnType<typeof import("./_api/defineGuildPlugin").defineGuildPlugin>> = {
    welcomeBanner: WelcomeBanner,
    customChannelNames: CustomChannelNames,
};
