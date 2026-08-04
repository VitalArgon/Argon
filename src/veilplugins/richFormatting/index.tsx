import definePlugin, { OptionType } from "@utils/types";
import { VeilDevs } from "@utils/constants";
import { definePluginSettings } from "@api/Settings";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { React } from "@webpack/common";
import * as Icons from "@components/Icons";
import { PluginCard } from "@components/settings/tabs/plugins/PluginCard";
import {
    h,
    createStyleInjector,
    observeMatches,
    openSimpleModal,
    findPluginByName,
    reactNodeToDom,
    Plugins,
    PluginMeta,
} from "../VeilCoreAPI";

const PROCESSED_ATTR = "data-rf-processed";

const ICON_ALIASES: Record<string, string> = {

    achievements: "AchievementsIcon",
    apps: "AppsIcon",
    attachment: "AttachmentIcon",
    backup: "BackupRestoreIcon",
    restore: "BackupRestoreIcon",
    down: "ChevronSmallDownIcon",
    chevrondown: "ChevronSmallDownIcon",
    up: "ChevronSmallUpIcon",
    chevronup: "ChevronSmallUpIcon",
    question: "CircleQuestionIcon",
    help: "CircleQuestionIcon",
    clock: "ClockIcon",
    time: "ClockIcon",
    clouddownload: "CloudDownloadIcon",
    cloud: "CloudIcon",
    cloudupload: "CloudUploadIcon",
    gear: "CogWheel",
    settings: "CogWheel",
    palette: "ColorPaletteIcon",
    color: "ColorPaletteIcon",
    copy: "CopyIcon",
    copyid: "CopyIdIcon",
    card: "CreditCardIcon",
    creditcard: "CreditCardIcon",
    delete: "DeleteIcon",
    trash: "DeleteIcon",
    doublecheck: "DoubleCheckmarkIcon",
    checkdouble: "DoubleCheckmarkIcon",
    downarrow: "DownArrow",
    equicord: "EquicordIcon",
    eye: "EyeIcon",
    folder: "FolderIcon",
    controller: "GameControllerIcon",
    game: "GameControllerIcon",
    gif: "GifIcon",
    github: "GithubIcon",
    hammerchisel: "HammerAndChiselIcon",
    hammer: "HammerIcon",
    headphones: "HeadphonesIcon",
    id: "IDIcon",
    image: "ImageIcon",
    imagehide: "ImageInvisible",
    imageshow: "ImageVisible",
    info: "InfoIcon",
    link: "LinkIcon",
    log: "LogIcon",
    search: "MagnifyingGlassIcon",
    magnify: "MagnifyingGlassIcon",
    mainsettings: "MainSettingsIcon",
    mic: "Microphone",
    microphone: "Microphone",
    noentry: "NoEntrySignIcon",
    ban: "NoEntrySignIcon",
    notes: "NotesIcon",
    external: "OpenExternalIcon",
    openexternal: "OpenExternalIcon",
    crown: "OwnerCrownIcon",
    owner: "OwnerCrownIcon",
    paintbrush: "PaintbrushIcon",
    paste: "PasteIcon",
    patch: "PatchHelperIcon",
    edit: "PencilIcon",
    pencil: "PencilIcon",
    sparkle: "PencilSparkleIcon",
    placeholder: "PlaceholderIcon",
    plugin: "PluginIcon",
    plugins: "PluginsIcon",
    plus: "PlusIcon",
    add: "PlusIcon",
    reply: "ReplyIcon",
    reset: "ResetIcon",
    restart: "RestartIcon",
    rightarrow: "RightArrow",
    robot: "RobotIcon",
    bot: "RobotIcon",
    safety: "SafetyIcon",
    screenshare: "ScreenshareIcon",
    shield: "ShieldIcon",
    mod: "ShieldIcon",
    skull: "SkullIcon",
    star: "StarFilled",
    starfilled: "StarFilled",
    staroutline: "StarOutlined",
    staroutlined: "StarOutlined",
    sticker: "StickerIcon",
    updater: "UpdaterIcon",
    user: "UserIcon",
    veil: "VeilIcon",
    vencord: "VencordIcon",
    vesktop: "VesktopSettingsIcon",
    video: "VideoIcon",
    warning: "WarningIcon",
    warn: "WarningIcon",
    website: "WebsiteIcon",

};

function getIconComponent(name: string) {
    const exportName = ICON_ALIASES[name.toLowerCase()] ?? name;

    return Icons[exportName] ?? null;
}

function renderIconInto(container: HTMLElement, name: string) {
    const IconComponent = getIconComponent(name);
    if (!IconComponent) {
        container.textContent = `[unknown icon: ${name}]`;
        container.className = "rf-icon-missing";
        return;
    }
    try {
        const element = h(IconComponent, { size: 16 });
        const dom = reactNodeToDom(element);
        if (!dom) throw new Error("converter produced no DOM output");
        container.appendChild(dom);

        const svgEl = (dom.nodeType === Node.ELEMENT_NODE && (dom as Element).tagName === "svg")
            ? (dom as unknown as SVGElement)
            : container.querySelector("svg");
        if (svgEl) {
            svgEl.removeAttribute("class");
            svgEl.removeAttribute("width");
            svgEl.removeAttribute("height");
            const svgStyle = (svgEl as unknown as HTMLElement).style;
            svgStyle.setProperty("width", "1.1em", "important");
            svgStyle.setProperty("height", "1.1em", "important");
            svgStyle.setProperty("flex-shrink", "0", "important");
        }
    } catch (e) {
        container.textContent = `[icon render failed: ${name}]`;
        console.error("[RichFormatting] icon render failed for", name, e);
    }
}

function normalizeHex(hex: string | undefined): string | null {
    if (!hex) return null;
    const clean = hex.trim().replace(/^#/, "");
    if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(clean)) return null;
    return `#${clean}`;
}

function buildButton(label: string, action: { type: "link" | "copy"; value: string }, hex?: string) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "rf-btn";

    const color = normalizeHex(hex);
    if (color) btn.style.backgroundColor = color;

    btn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        if (action.type === "link") {
            window.open(action.value, "_blank", "noopener,noreferrer");
        } else {
            navigator.clipboard.writeText(action.value).then(() => {
                const old = btn.textContent;
                btn.textContent = "Copied!";
                setTimeout(() => (btn.textContent = old), 1200);
            });
        }
    });
    return btn;
}

function buildBadge(color: string, text: string) {
    const span = document.createElement("span");
    span.className = `rf-badge rf-badge-${color}`;
    span.textContent = text;
    return span;
}

function buildProgress(pct: number) {
    const wrap = document.createElement("span");
    wrap.className = "rf-progress-wrap";
    const bar = document.createElement("span");
    bar.className = "rf-progress-bar";
    bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    const label = document.createElement("span");
    label.className = "rf-progress-label";
    label.textContent = `${pct}%`;
    wrap.append(bar, label);
    return wrap;
}

function buildFold(title: string, bodyText: string) {
    const details = document.createElement("details");
    details.className = "rf-fold";
    const summary = document.createElement("summary");
    summary.textContent = title;
    const body = document.createElement("div");
    body.className = "rf-fold-body";
    body.appendChild(processInlineIntoFragment(bodyText));
    details.append(summary, body);
    return details;
}

function buildIconSpan(name: string) {
    const span = document.createElement("span");
    span.className = "rf-icon";
    renderIconInto(span, name);
    return span;
}

function openPluginCardModal(plugin: any) {
    openSimpleModal(plugin.name, () =>
        h(PluginCard, {
            plugin,
            disabled: plugin.required ?? false,
            onRestartNeeded: () => {},
        })
    );
}

function buildPluginCardSpan(rawName: string) {
    const plugin = findPluginByName(rawName);
    if (!plugin) {
        const span = document.createElement("span");
        span.textContent = `[plugin not found: ${rawName}]`;
        span.className = "rf-icon-missing";
        return span;
    }

    const card = document.createElement("div");
    card.className = "rf-plugin-card";
    card.title = "Click for full plugin settings";
    card.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        openPluginCardModal(plugin);
    });

    const accent = document.createElement("div");
    accent.className = "rf-plugin-card-accent";

    const body = document.createElement("div");
    body.className = "rf-plugin-card-body";

    const header = document.createElement("div");
    header.className = "rf-plugin-card-header";

    const iconWrap = document.createElement("span");
    iconWrap.className = "rf-plugin-card-icon";
    renderIconInto(iconWrap, "plugin");

    const nameEl = document.createElement("span");
    nameEl.className = "rf-plugin-card-name";
    nameEl.textContent = plugin.name;

    const pluginInfo = [
        {
            condition: (plugin.isVeilModified ?? false) && PluginMeta[plugin.name]?.folderName?.startsWith("src/equicordplugins/"),
            src: "https://raw.githubusercontent.com/VitalVeil/Veil/main/browser/Modified.png",
            alt: "Veil Modified",
            title: "Modified Equicord Plugin"
        },
        {
            condition: plugin.isModified ?? false,
            src: "https://equicord.org/assets/icons/equicord/modified.png",
            alt: "Modified",
            title: "Modified Vencord Plugin"
        },
        {
            condition: PluginMeta[plugin.name]?.folderName?.startsWith("src/equicordplugins/"),
            src: "https://equicord.org/assets/favicon.png",
            alt: "Equicord",
            title: "Equicord Plugin"
        },
        {
            condition: PluginMeta[plugin.name]?.folderName?.startsWith("src/plugins/"),
            src: "https://equicord.org/assets/icons/vencord/icon-light.png",
            alt: "Vencord",
            title: "Vencord Plugin"
        },
        {
            condition: PluginMeta[plugin.name]?.folderName?.startsWith("src/veilplugins/"),
            src: "https://raw.githubusercontent.com/Zarak199076/Veil/main/browser/icon.png",
            alt: "Veil",
            title: "Veil Plugin"
        },
        {
            condition: PluginMeta[plugin.name]?.userPlugin ?? false,
            src: "https://equicord.org/assets/icons/misc/userplugin.png",
            alt: "User",
            title: "User Plugin"
        }
    ];

    const pluginDetails = pluginInfo.find(p => p.condition);

    const sourceImg = pluginDetails ? document.createElement("img") : null;
    if (sourceImg && pluginDetails) {
        sourceImg.src = pluginDetails.src;
        sourceImg.alt = pluginDetails.alt;
        sourceImg.title = pluginDetails.title;
        sourceImg.className = "rf-plugin-card-source-img";
    }

    const titleGroup = document.createElement("div");
    titleGroup.className = "rf-plugin-card-title-group";
    titleGroup.append(iconWrap);

    const titleTextWrap = document.createElement("div");
    titleTextWrap.className = "rf-plugin-card-text";
    titleTextWrap.appendChild(nameEl);

    if (sourceImg) titleTextWrap.appendChild(sourceImg);
    titleGroup.appendChild(titleTextWrap);

    const infoBtn = document.createElement("button");
    infoBtn.className = "rf-plugin-card-info-button";
    infoBtn.title = pluginDetails?.title ?? "Plugin info";
    infoBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        openPluginCardModal(plugin);
    });
    renderIconInto(infoBtn, "CogWheel");

    const enabled = !!plugin.started || !!plugin.enabled;
    const toggle = document.createElement("span");
    toggle.className = `rf-toggle ${enabled ? "rf-toggle-on" : "rf-toggle-off"}`;
    const knob = document.createElement("span");
    knob.className = "rf-toggle-knob";
    toggle.appendChild(knob);

    const rightGroup = document.createElement("div");
    rightGroup.className = "rf-plugin-card-right";
    rightGroup.append(toggle, infoBtn);

    header.append(titleGroup, rightGroup);

    const desc = document.createElement("div");
    desc.className = "rf-plugin-card-desc";
    desc.textContent = plugin.description ?? "";

    body.append(header, desc);

    if (Array.isArray(plugin.authors) && plugin.authors.length) {
        const authorsEl = document.createElement("div");
        authorsEl.className = "rf-plugin-card-authors";
        authorsEl.textContent = plugin.authors.map((a: any) => a.name).filter(Boolean).join(" · ");
        body.appendChild(authorsEl);
    }

    card.append(accent, body);

    return card;
}

function buildColoredText(hex: string, text: string) {
    const span = document.createElement("span");
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    span.style.color = normalized;
    span.textContent = text;
    return span;
}

function parseShortcuts(raw: string): Map<string, string> {
    const map = new Map<string, string>();
    const lineRe = /^\{\{([a-zA-Z0-9_]+)\}\}\s*=\s*(.+)$/;
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const match = trimmed.match(lineRe);
        if (!match) continue;
        map.set(match[1], match[2].trim());
    }
    return map;
}

const SHORTCUTS_URL = "https://raw.githubusercontent.com/Zarak199076/veil/refs/heads/main/src/veilplugins/richFormatting/ext.txt";

let shortcuts = new Map<string, string>();

async function loadShortcuts() {
    try {
        const res = await fetch(SHORTCUTS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.text();
        shortcuts = parseShortcuts(raw);
        console.log(`[RichFormatting] loaded ${shortcuts.size} shortcut(s) from ext.txt`);
    } catch (e) {
        console.error("[RichFormatting] failed to load ext.txt shortcuts:", e);
    }
}

function expandShortcuts(text: string): string {
    if (!shortcuts.size) return text;
    return text.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (full, name) =>
        shortcuts.has(name) ? shortcuts.get(name)! : full
    );
}

const TOKEN_RE = new RegExp(
    [
        String.raw`\{\{btn:([^|}]+)\|(https?:\/\/[^\s|}]+)(?:\|([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))?\}\}`,
        String.raw`\{\{btn:([^|}]+)\|copy:([^}]+?)(?:\|([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8}))?\}\}`,
        String.raw`\{\{badge:(red|green|blue|yellow|gray)\|([^}]+)\}\}`,
        String.raw`\{\{progress:(\d{1,3})\}\}`,
        String.raw`\{\{fold:([^|}]+)\|([^}]*)\}\}`,
        String.raw`\{\{icon:([a-zA-Z0-9_]+)\}\}`,
        String.raw`\{\{plugin:"?([^"}]+?)"?\}\}`,
        String.raw`\{\{colored:(#?[0-9a-fA-F]{3,8}):([^}]*)\}\}`,
    ].join("|"),
    "g"
);

const BLOCK_FOLD_RE = /:::fold\s+([^\n]+)\n([\s\S]*?):::/g;
const ANY_SYNTAX_RE = /\{\{btn:|\{\{badge:|\{\{progress:|\{\{fold:|\{\{icon:|\{\{plugin:|\{\{colored:|:::fold/;

function processInlineIntoFragment(text: string) {
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const tokenRe = new RegExp(TOKEN_RE.source, "g");

    while ((match = tokenRe.exec(text)) !== null) {
        if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        if (match[1] !== undefined) frag.appendChild(buildButton(match[1], { type: "link", value: match[2] }, match[3]));
        else if (match[4] !== undefined) frag.appendChild(buildButton(match[4], { type: "copy", value: match[5] }, match[6]));
        else if (match[7] !== undefined) frag.appendChild(buildBadge(match[7], match[8]));
        else if (match[9] !== undefined) frag.appendChild(buildProgress(parseInt(match[9], 10)));
        else if (match[10] !== undefined) frag.appendChild(buildFold(match[10], match[11]));
        else if (match[12] !== undefined) frag.appendChild(buildIconSpan(match[12]));
        else if (match[13] !== undefined) frag.appendChild(buildPluginCardSpan(match[13]));
        else if (match[14] !== undefined) frag.appendChild(buildColoredText(match[14], match[15]));

        lastIndex = tokenRe.lastIndex;

        if (tokenRe.lastIndex === match.index) tokenRe.lastIndex++;
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    return frag;
}

function shouldSkipElement(el: Element): boolean {
    if (el.tagName === "CODE" || el.tagName === "PRE") return true;
    const className = (el as HTMLElement).className;
    if (typeof className === "string" && /edited/i.test(className)) return true;
    return false;
}

function processTextNode(node: Text) {
    const raw = node.textContent ?? "";
    const expanded = expandShortcuts(raw);

    const blockFoldRe = new RegExp(BLOCK_FOLD_RE.source, "g");
    if (blockFoldRe.test(expanded)) {
        blockFoldRe.lastIndex = 0;
        const newFrag = document.createDocumentFragment();
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = blockFoldRe.exec(expanded)) !== null) {
            if (match.index > lastIndex) newFrag.appendChild(processInlineIntoFragment(expanded.slice(lastIndex, match.index)));
            newFrag.appendChild(buildFold(match[1].trim(), match[2].trim()));
            lastIndex = blockFoldRe.lastIndex;
        }
        if (lastIndex < expanded.length) newFrag.appendChild(processInlineIntoFragment(expanded.slice(lastIndex)));
        node.replaceWith(newFrag);
        return;
    }

    if (ANY_SYNTAX_RE.test(expanded)) {
        node.replaceWith(processInlineIntoFragment(expanded));
    } else if (expanded !== raw) {
        node.textContent = expanded;
    }
}

function walkNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
        processTextNode(node as Text);
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    if (shouldSkipElement(el)) return;

    Array.from(el.childNodes).forEach(walkNode);
}

function processMessageContentEl(el: HTMLElement) {
    if (!el || el.getAttribute(PROCESSED_ATTR) === "true") return;

    const quickCheck = expandShortcuts(el.textContent ?? "");
    if (!ANY_SYNTAX_RE.test(quickCheck)) {
        el.setAttribute(PROCESSED_ATTR, "true");
        return;
    }

    Array.from(el.childNodes).forEach(walkNode);
    el.setAttribute(PROCESSED_ATTR, "true");
}

const STYLE_ID = "rf-styles";
const rfStyles = createStyleInjector(STYLE_ID, `
        .rf-btn { background:#5865F2;color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:500;cursor:pointer;margin:2px 4px 2px 0; }
        .rf-btn:hover { filter:brightness(0.88); }
        .rf-badge { display:inline-block;padding:1px 8px;border-radius:8px;font-size:12px;font-weight:600;margin:0 2px;color:#fff; }
        .rf-badge-red{background:#ED4245;} .rf-badge-green{background:#3BA55D;} .rf-badge-blue{background:#5865F2;}
        .rf-badge-yellow{background:#FAA61A;color:#1a1a1a;} .rf-badge-gray{background:#747F8D;}
        .rf-progress-wrap{display:inline-flex;align-items:center;background:#2b2d31;border-radius:6px;width:160px;height:18px;position:relative;overflow:hidden;margin:0 4px;vertical-align:middle;}
        .rf-progress-bar{display:inline-block;background:linear-gradient(90deg,#5865F2,#3BA55D);height:100%;}
        .rf-progress-label{position:absolute;left:6px;top:0;font-size:11px;line-height:18px;color:#fff;text-shadow:0 0 2px rgba(0,0,0,.8);}
        .rf-fold{border:1px solid #3f4147;border-radius:6px;margin:4px 0;background:#2b2d31;}
        .rf-fold summary{cursor:pointer;padding:6px 10px;font-weight:600;color:#dbdee1;list-style:none;user-select:none;}
        .rf-fold summary::-webkit-details-marker{display:none;}
        .rf-fold summary::before{content:"▶";display:inline-block;margin-right:6px;font-size:10px;transition:transform .15s ease;}
        .rf-fold[open] summary::before{transform:rotate(90deg);}
        .rf-fold-body{padding:4px 12px 10px 12px;color:#dbdee1;white-space:pre-wrap;}
        .rf-icon{display:inline-flex;vertical-align:middle;margin:0 2px;}
        .rf-icon-missing{color:#ED4245;font-size:12px;font-style:italic;}
        .rf-plugin-card{display:flex;align-items:stretch;background:#2b2d31;border:1px solid #3a3c42;border-radius:10px;margin:6px 0;max-width:420px;cursor:pointer;text-align:left;overflow:hidden;}
        .rf-plugin-card:hover{border-color:#A259FF;transform:translateY(-1px);}
        .rf-plugin-card:active{transform:translateY(0);}
        .rf-plugin-card-accent{width:4px;flex-shrink:0;background:linear-gradient(180deg,#A259FF,#6C3FBF);}
        .rf-plugin-card-body{padding:11px 14px;flex:1;min-width:0;}
        .rf-plugin-card-header{display:flex;align-items:center;justify-content:space-between;gap:10px;}
        .rf-plugin-card-title-group{display:flex;align-items:center;gap:7px;min-width:0;}
        .rf-plugin-card-icon{display:inline-flex;color:#A259FF;flex-shrink:0;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;background:rgba(162,89,255,0.08);}
        .rf-plugin-card-text{display:flex;flex-direction:row;align-items:center;gap:8px;min-width:0;}
        .rf-plugin-card-source-img{width:18px;height:18px;margin-left:6px;border-radius:4px;}
        .rf-plugin-card-name{font-weight:700;color:#f2f3f5;font-size:14px;letter-spacing:.1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .rf-plugin-card-right{display:flex;align-items:center;gap:8px;}
        .rf-plugin-card-info-button{background:transparent;border:none;padding:6px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--interactive-normal);}
        .rf-toggle{display:inline-block;width:44px;height:24px;border-radius:999px;background:rgba(148,155,164,0.16);position:relative;}
        .rf-toggle.rf-toggle-on{background:linear-gradient(90deg,#A259FF,#6C3FBF);}
        .rf-toggle-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .08s ease;box-shadow:0 1px 2px rgba(0,0,0,0.3);}
        .rf-toggle.rf-toggle-on .rf-toggle-knob{left:23px;}
        .rf-plugin-card-desc{color:#b5bac1;font-size:12.5px;line-height:1.45;margin-top:8px;}
        .rf-plugin-card-authors{color:#80848e;font-size:11px;margin-top:8px;font-weight:500;}
 `);

function buildHelpText() {
    const iconNames = Object.keys(ICON_ALIASES).sort().join(", ");

    const zw = "{{\u200B";
    return [
        "**RichFormatting syntax reference** (only renders for you, client-side)",
        "",
        `**Button (opens link):** \`${zw}btn:Label|https://example.com}}\` — add \`|hexcode\` for a custom color, e.g. \`${zw}btn:Label|https://example.com|FF5555}}\``,
        `**Button (copies text):** \`${zw}btn:Label|copy:some text}}\` — same optional \`|hexcode\` at the end`,
        `**Badge:** \`${zw}badge:red|Urgent}}\` — colors: red, green, blue, yellow, gray`,
        `**Progress bar:** \`${zw}progress:65}}\``,
        `**Inline fold:** \`${zw}fold:Title|hidden text}}\``,
        "**Block fold:**",
        "```",
        ":::fold\u200B Click to expand",
        "any text here, can nest other tags too",
        ":::",
        "```",
        `**Icon:** \`${zw}icon:name}}\``,
        `Available icon names: ${iconNames}`,
        `**Plugin card:** \`${zw}plugin:"Plugin Name"}}\` (quotes optional)`,
        `**Colored text:** \`${zw}colored:A259FF:some text}}\` — hex code, # optional`,
        "",
        `**Shortcuts** (defined in ext.txt): ${shortcuts.size ? [...shortcuts.keys()].map(k => `\`{{${k}}}\``).join(", ") : "none loaded"}`,
    ].join("\n");
};

const settings = definePluginSettings({
    logIconsOnStart: {
        type: OptionType.BOOLEAN,
        description: "Log every available icon export name to devtools console on startup (use this to find real names for ICON_ALIASES)",
        default: false,
    },
});

let stopObservingMessages: (() => void) | null = null;

export default definePlugin({
    name: "RichFormatting",
    description: "Type-to-render buttons, badges, progress bars, collapsible folds, inline Discord icons, and embedded plugin cards in messages (client-side only).",
    tags: ["Utility", "Veil", "Fun"],
    authors: [VeilDevs.Zarak],
    settings,
    dependencies: ["CommandsAPI", "VeilCoreAPI"],

    commands: [
        {
            name: "richformat-help",
            description: "List all RichFormatting text syntax options",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_opts, ctx) => {

                sendBotMessage(ctx.channel.id, { content: buildHelpText() });
            },
        },
        {
            name: "richformat-reload-shortcuts",
            description: "Re-fetch ext.txt shortcuts from GitHub without restarting Discord",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: async (_opts, ctx) => {
                await loadShortcuts();
                sendBotMessage(ctx.channel.id, {
                    content: `Reloaded — ${shortcuts.size} shortcut(s) loaded.`,
                });
            },
        },
    ],

    start() {
        rfStyles.inject();

        if (settings.store.logIconsOnStart) {
            console.log("[RichFormatting] Available icons in this build:", Object.keys(Icons).sort());
        }

        loadShortcuts();

        stopObservingMessages = observeMatches(
            '[id^="message-content-"]',
            el => processMessageContentEl(el as HTMLElement)
        );
    },

    stop() {
        stopObservingMessages?.();
        stopObservingMessages = null;
        rfStyles.remove();
        document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => el.removeAttribute(PROCESSED_ATTR));
    },
});
