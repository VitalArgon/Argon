import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { React } from "@webpack/common";
import * as Icons from "@components/Icons";

const PROCESSED_ATTR = "data-rf-processed";

const ICON_ALIASES: Record<string, string> = {

    achievements: "AchievementsIcon",
    apps: "AppsIcon",
    attachment: "AttachmentIcon",
    backup: "BackupRestoreIcon",
    restore: "BackupRestoreIcon",
    bookmark: "BookmarkIcon",
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
    components: "ComponentsIcon",
    copy: "CopyIcon",
    copyid: "CopyIdIcon",
    card: "CreditCardIcon",
    creditcard: "CreditCardIcon",
    delete: "DeleteIcon",
    trash: "DeleteIcon",
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
    logs: "LogsIcon",
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
    qr: "QrCodeIcon",
    qrcode: "QrCodeIcon",
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
    sticker: "StickerIcon",
    updater: "UpdaterIcon",
    user: "UserIcon",
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

const SVG_NS = "http://www.w3.org/2000/svg";

const SVG_ATTR_CAMEL_KEEP = new Set([
    "viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform",
    "patternUnits", "patternContentUnits", "patternTransform", "spreadMethod",
    "clipPathUnits", "markerUnits", "markerWidth", "markerHeight", "refX", "refY",
    "attributeName", "attributeType", "repeatCount", "repeatDur", "calcMode",
    "keyTimes", "keySplines", "keyPoints", "xChannelSelector", "yChannelSelector",
]);

function svgAttrName(prop: string): string {
    if (prop === "className") return "class";
    if (SVG_ATTR_CAMEL_KEEP.has(prop)) return prop;
    if (/^[a-z-]+$/.test(prop)) return prop; 
    return prop.replace(/([A-Z])/g, "-$1").toLowerCase();
}

function reactNodeToDom(node: any): Node | null {
    if (node === null || node === undefined || typeof node === "boolean") return null;
    if (typeof node === "string" || typeof node === "number") {
        return document.createTextNode(String(node));
    }
    if (Array.isArray(node)) {
        const frag = document.createDocumentFragment();
        node.forEach(child => {
            const dom = reactNodeToDom(child);
            if (dom) frag.appendChild(dom);
        });
        return frag;
    }
    if (typeof node === "object" && "type" in node) {
        const { type, props } = node as { type: any; props: any };

        if (typeof type === "function") {
            return reactNodeToDom(type(props ?? {}));
        }

        if (typeof type === "string") {
            const el = document.createElementNS(SVG_NS, type);
            for (const [key, value] of Object.entries(props ?? {})) {
                if (key === "children" || key === "key" || key === "ref") continue;
                if (value === undefined || value === null || value === false) continue;
                if (key === "style" && typeof value === "object") {
                    Object.assign((el as any).style, value);
                    continue;
                }
                el.setAttribute(svgAttrName(key), String(value));
            }
            const childDom = reactNodeToDom(props?.children);
            if (childDom) el.appendChild(childDom);
            return el;
        }
    }
    return null;
}

function renderIconInto(container: HTMLElement, name: string) {
    const IconComponent = getIconComponent(name);
    if (!IconComponent) {
        container.textContent = `[unknown icon: ${name}]`;
        container.className = "rf-icon-missing";
        return;
    }
    try {
        const element = React.createElement(IconComponent, { size: 16 });
        const dom = reactNodeToDom(element);
        if (!dom) throw new Error("converter produced no DOM output");
        container.appendChild(dom);
    } catch (e) {
        container.textContent = `[icon render failed: ${name}]`;
        console.error("[RichFormatting] icon render failed for", name, e);
    }
}

function buildButton(label: string, action: { type: "link" | "copy"; value: string }) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "rf-btn";
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

const TOKEN_RE = new RegExp(
    [
        String.raw`\{\{btn:([^|}]+)\|(https?:\/\/[^\s}]+)\}\}`,        
        String.raw`\{\{btn:([^|}]+)\|copy:([^}]+)\}\}`,                
        String.raw`\{\{badge:(red|green|blue|yellow|gray)\|([^}]+)\}\}`, 
        String.raw`\{\{progress:(\d{1,3})\}\}`,                        
        String.raw`\{\{fold:([^|}]+)\|([^}]*)\}\}`,                    
        String.raw`\{\{icon:([a-zA-Z0-9_]+)\}\}`,                      
    ].join("|"),
    "g"
);

const BLOCK_FOLD_RE = /:::fold\s+([^\n]+)\n([\s\S]*?):::/g;
const ANY_SYNTAX_RE = /\{\{btn:|\{\{badge:|\{\{progress:|\{\{fold:|\{\{icon:|:::fold/;

function processInlineIntoFragment(text: string) {
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    const tokenRe = new RegExp(TOKEN_RE.source, "g");

    while ((match = tokenRe.exec(text)) !== null) {
        if (match.index > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        if (match[1] !== undefined) frag.appendChild(buildButton(match[1], { type: "link", value: match[2] }));
        else if (match[3] !== undefined) frag.appendChild(buildButton(match[3], { type: "copy", value: match[4] }));
        else if (match[5] !== undefined) frag.appendChild(buildBadge(match[5], match[6]));
        else if (match[7] !== undefined) frag.appendChild(buildProgress(parseInt(match[7], 10)));
        else if (match[8] !== undefined) frag.appendChild(buildFold(match[8], match[9]));
        else if (match[10] !== undefined) frag.appendChild(buildIconSpan(match[10]));

        lastIndex = tokenRe.lastIndex;

        if (tokenRe.lastIndex === match.index) tokenRe.lastIndex++;
    }
    if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    return frag;
}

function processMessageContentEl(el: HTMLElement) {
    if (!el || el.getAttribute(PROCESSED_ATTR) === "true") return;
    const original = el.textContent ?? "";
    if (!ANY_SYNTAX_RE.test(original)) {
        el.setAttribute(PROCESSED_ATTR, "true");
        return;
    }

    const blockFoldRe = new RegExp(BLOCK_FOLD_RE.source, "g");
    const newFrag = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let foundBlock = false;

    while ((match = blockFoldRe.exec(original)) !== null) {
        foundBlock = true;
        if (match.index > lastIndex) newFrag.appendChild(processInlineIntoFragment(original.slice(lastIndex, match.index)));
        newFrag.appendChild(buildFold(match[1].trim(), match[2].trim()));
        lastIndex = blockFoldRe.lastIndex;
    }
    if (foundBlock && lastIndex < original.length) newFrag.appendChild(processInlineIntoFragment(original.slice(lastIndex)));
    else if (!foundBlock) newFrag.appendChild(processInlineIntoFragment(original));

    el.innerHTML = "";
    el.appendChild(newFrag);
    el.setAttribute(PROCESSED_ATTR, "true");
}

function scanForMessages(root: ParentNode) {
    root.querySelectorAll?.('[id^="message-content-"]').forEach(node => processMessageContentEl(node as HTMLElement));
}

const STYLE_ID = "rf-styles";
function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .rf-btn { background:#5865F2;color:#fff;border:none;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:500;cursor:pointer;margin:2px 4px 2px 0; }
        .rf-btn:hover { background:#4752C4; }
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
    `;
    document.head.appendChild(style);
}

function buildHelpText() {
    const iconNames = Object.keys(ICON_ALIASES).sort().join(", ");

    const zw = "{{\u200B";
    return [
        "**RichFormatting syntax reference** (only renders for you, client-side)",
        "",
        `**Button (opens link):** \`${zw}btn:Label|https://example.com}}\``,
        `**Button (copies text):** \`${zw}btn:Label|copy:some text}}\``,
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
    ].join("\n");
};

const settings = definePluginSettings({
    logIconsOnStart: {
        type: OptionType.BOOLEAN,
        description: "Log every available icon export name to devtools console on startup (use this to find real names for ICON_ALIASES)",
        default: false,
    },
});

let observer: MutationObserver | null = null;

export default definePlugin({
    name: "RichFormatting",
    description: "Type-to-render buttons, badges, progress bars, collapsible folds, and inline Discord icons in messages (client-side only).",
    authors: [VeilDevs.Zarak],
    settings,
    dependencies: ["CommandsAPI"],

    commands: [
        {
            name: "richformat-help",
            description: "List all RichFormatting text syntax options",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_opts, ctx) => {

                sendBotMessage(ctx.channel.id, { content: buildHelpText() });
            },
        },
    ],

    start() {
        injectStyles();

        if (settings.store.logIconsOnStart) {
            console.log("[RichFormatting] Available icons in this build:", Object.keys(Icons).sort());
        }

        scanForMessages(document.body);
        observer = new MutationObserver(mutations => {
            for (const m of mutations) {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1) return;
                    const el = node as HTMLElement;
                    if (el.id?.startsWith("message-content-")) processMessageContentEl(el);
                    else scanForMessages(el);
                });
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        observer?.disconnect();
        observer = null;
        document.getElementById(STYLE_ID)?.remove();
        document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el => el.removeAttribute(PROCESSED_ATTR));
    },
});
