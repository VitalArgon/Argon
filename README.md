# [<img src="./browser/icon.png" width="40" align="left" alt="Argon">](https://github.com/VitalArgon/Argon) Argon

A Discord client mod, forked from [Equicord](https://github.com/Equicord/Equicord), which is forked from [Vencord](https://github.com/Vendicated/Vencord).

Argon keeps the whole upstream Equicord plugin set and adds a set of its own, plus a framework for **guild plugins**: plugins that a server enables for its own members, configured from a channel topic rather than by each user.

## Argon's own plugins

| Plugin | What it does |
| --- | --- |
| **ArgonCoreAPI** | Shared helpers the other Argon plugins are built on: style injection, DOM observing, modals, logging, toasts, Flux helpers, an EventBus, debounce/throttle, `waitFor`, simple stores. |
| **Guild Plugins** | The framework below: a Settings tab where you opt in per server. |
| **NitroSniper** | Watches for Nitro gift links in chat and redeems them, optionally posting the result to a webhook. |
| **richFormatting** | Type-to-render buttons, badges, progress bars, folds, icons and plugin cards in your own messages (client-side only). |
| **StatusCycler** | Rotates your custom status text and emoji on a timer. |
| **SnippetVault** | Save, tag and reuse text and code snippets from a toolbar button. |
| **MusicalThemes** | Reskins Discord from the album art of the track you are playing. |
| **LyricStats** | Lyric statistics for whatever you are listening to. |
| **Server Badges** | Makes servers you own display the Verified and Partnered header badges. |
| **Argon Badges** | Custom badges from the Argon community server. |
| **GifSources** | Search several GIF providers at once with `/multi-gif`, bypassing Discord's own picker. |
| **SilentEdit** | Edits a message without the edit tag, and without Vencord's message logger recording it. |
| **AbbreviationExpander**, **AntiBadwords**, **ArgonTag**, **Fake accounts**, **HypeSquadSwitcher**, **Spaced out**, **ThreadHider**, **DontLimitMe** | Smaller quality-of-life plugins. |

Everything else in the plugin list comes from Equicord upstream.

## Guild plugins

A guild plugin runs only while you are in the server that declares it, and only if you have opted in.

**To enable one for your server:** create (or reuse) a channel named `#rules` and put this JSON in the channel's **topic**:

```json
{
    "guildName": "My Server",
    "pluginIds": ["guildTheme", "customChannelNames"],
    "promptOnJoin": true
}
```

`pluginIds` must name plugins from the list below. Anything unknown is ignored, so a typo just silently does nothing. Once the topic is saved, the plugin appears in **Settings → Guild Plugins**, where each member of the server ticks it on or off; Argon remembers that choice per server and per plugin.

**Current guild plugins**

| Id | What it does | Config lives in |
| --- | --- | --- |
| `guildTheme` | Applies CSS while you are viewing the server | the topic of a channel named `#css` |
| `customChannelNames` | Renders `{shorthand = replacement}` substitutions in channel names, display only | the topic of a channel named `#customnames` |
| `channelPopups` | Shows a popup the first time you open a channel, per session | that channel's topic or description |
| `categoryBanners` | Renders banners on category lines | the category's own settings |

A guild plugin stops when you leave the server it belongs to, and when you untick it. New guild plugins go in `src/argoncore/guildplugins/`, defined with `defineGuildPlugin` and registered in `src/argoncore/guildplugins/index.ts`.

## Installing

Argon is built from source; there are no prebuilt installers yet.

You need [Git](https://git-scm.com/download) and [Node.js LTS](https://nodejs.dev/en/), then `pnpm`:

```shell
npm i -g pnpm
```

Clone and install:

```shell
git clone https://github.com/VitalArgon/Argon
cd Argon
pnpm install --frozen-lockfile
```

### Desktop

```shell
pnpm build
pnpm inject
```

### Browser

```shell
pnpm buildWeb
```

Unzip what lands in `dist/` and load it as an unpacked extension (Chrome and Edge: enable developer mode on the extensions page; Firefox: use a Developer Edition build and load the temporary add-on).

## Development

```shell
pnpm watch        # desktop, rebuilds on change
pnpm watchWeb     # browser
pnpm test         # typecheck + lint
pnpm lint:fix     # format and fix
```

`pnpm test` never touches the network and never writes files, so it is safe in CI and before a commit.

## Credits

- [Vendicated](https://github.com/Vendicated) for [Vencord](https://github.com/Vendicated/Vencord)
- [Equicord](https://github.com/Equicord/Equicord) for the fork this one tracks
- [verticalsync](https://github.com/verticalsync) for [Suncord](https://github.com/verticalsync/Suncord)

## Disclaimer

1. Discord is a trademark of Discord Inc., mentioned only for descriptivity. Nothing here implies affiliation with or endorsement by Discord Inc.
2. If you take plugins from this repo, take **ArgonCoreAPI** as well; several of them depend on it.
3. Client modifications are against Discord's Terms of Service. Discord is generally indifferent to them and there are no known cases of an account being actioned purely for using one, but that can change, and a screenshot in the wrong server can get you banned.
