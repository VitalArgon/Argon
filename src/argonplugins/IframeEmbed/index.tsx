import { addAccessory, removeAccessory } from "@api/MessageAccessories";
import { definePluginSettings } from "@api/Settings";
import { ArgonDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "discord-types/general";

const ACCESSORY_ID = "MessageIframes";

// Matches a single <iframe ...></iframe> (or self-closed) tag, non-greedy.
const IFRAME_REGEX = /<iframe\b[^>]*>[\s\S]*?<\/iframe>|<iframe\b[^>]*\/>/gi;

// Very small attribute parser — good enough for iframe tags, not a general HTML parser.
function parseAttrs(tag: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const attrRegex = /([a-zA-Z-]+)\s*=\s*"([^"]*)"|([a-zA-Z-]+)\s*=\s*'([^']*)'/g;
    let m: RegExpExecArray | null;
    while ((m = attrRegex.exec(tag)) !== null) {
        const key = (m[1] ?? m[3]).toLowerCase();
        const value = m[2] ?? m[4] ?? "";
        attrs[key] = value;
    }
    return attrs;
}

function isAllowedHost(src: string, allowlist: string[]): boolean {
    try {
        const url = new URL(src);
        if (url.protocol !== "https:") return false;
        const host = url.hostname.toLowerCase();
        return allowlist.some(allowed => {
            allowed = allowed.trim().toLowerCase();
            if (!allowed) return false;
            return host === allowed || host.endsWith("." + allowed);
        });
    } catch {
        return false;
    }
}

const settings = definePluginSettings({
    allowedHosts: {
        type: OptionType.STRING,
        description: "Comma-separated list of hostnames allowed to render as iframes (subdomains included). Iframes pointing anywhere else are shown as a plain link instead.",
        default: "discord.com,youtube.com,youtube-nocookie.com,open.spotify.com,codepen.io,codesandbox.io",
        restartNeeded: false,
    },
    maxHeight: {
        type: OptionType.NUMBER,
        description: "Maximum height (px) an embedded iframe is allowed to render at",
        default: 500,
        restartNeeded: false,
    },
    forceSandbox: {
        type: OptionType.BOOLEAN,
        description: "Ignore the sandbox attribute from the message and always use a safe default sandbox policy",
        default: true,
        restartNeeded: false,
    },
});

const SAFE_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms";

function IframeEmbed({ src, width, height, allowtransparency, sandbox }: {
    src: string; width?: string; height?: string; allowtransparency?: string; sandbox?: string;
}) {
    const maxH = settings.store.maxHeight;
    const h = Math.min(parseInt(height || "350", 10) || 350, maxH);
    const w = Math.min(parseInt(width || "500", 10) || 500, 700);

    return (
        <iframe
            src={src}
            width={w}
            height={h}
            allowTransparency={allowtransparency !== "false"}
            frameBorder={0}
            sandbox={settings.store.forceSandbox ? SAFE_SANDBOX : (sandbox || SAFE_SANDBOX)}
            style={{ borderRadius: 8, border: "none", marginTop: 4, display: "block" }}
            loading="lazy"
        />
    );
}

function BlockedEmbed({ src }: { src: string; }) {
    return (
        <a
            href={src}
            target="_blank"
            rel="noreferrer noopener"
            style={{ display: "block", marginTop: 4, fontStyle: "italic", opacity: 0.8 }}
        >
            [MessageIframes] Blocked embed from untrusted host — click to open: {src}
        </a>
    );
}

function getIframeAccessories(message: Message) {
    const content = message?.content;
    if (!content || !content.includes("<iframe")) return null;

    const matches = content.match(IFRAME_REGEX);
    if (!matches || matches.length === 0) return null;

    const allowlist = settings.store.allowedHosts.split(",");

    return matches.map((tag, i) => {
        const attrs = parseAttrs(tag);
        if (!attrs.src) return null;

        if (!isAllowedHost(attrs.src, allowlist)) {
            return <BlockedEmbed key={i} src={attrs.src} />;
        }

        return (
            <IframeEmbed
                key={i}
                src={attrs.src}
                width={attrs.width}
                height={attrs.height}
                allowtransparency={attrs.allowtransparency}
                sandbox={attrs.sandbox}
            />
        );
    }).filter(Boolean);
}

export default definePlugin({
    name: "MessageIframes",
    description: "Renders <iframe> tags in message content as real embedded iframes",
    authors: [ArgonDevs.Zarak],
    settings,

    start() {
        addAccessory(ACCESSORY_ID, props => {
            const accessories = getIframeAccessories(props.message);
            if (!accessories || accessories.length === 0) return null;
            return <>{accessories}</>;
        });
    },

    stop() {
        removeAccessory(ACCESSORY_ID);
    },
});
