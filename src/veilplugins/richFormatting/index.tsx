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

function renderIconInto(container: HTMLElement, name: string, hex?: string) {
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

            const color = normalizeHex(hex);
            if (color) svgStyle.setProperty("color", color, "important");
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

function buildIconSpan(name: string, hex?: string) {
    const span = document.createElement("span");
    span.className = "rf-icon";
    renderIconInto(span, name, hex);
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
            title: "Equicord plugin modified by Veil"
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
