import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { ArgonDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { FluxDispatcher } from "@webpack/common";
import { Message } from "discord-types/general";

const ACCESSORY_ID = "MessageIframes";

// Hardcoded config — edit these directly, no in-app settings.
const ALLOWED_HOSTS = [
    "discord.com",
    "youtube.com",
    "youtube-nocookie.com",
    "open.spotify.com",
    "codepen.io",
    "codesandbox.io",
];
const MAX_HEIGHT = 500;
const FORCE_SANDBOX = false;

// Matches a single <iframe ...></iframe> (or self-closed) tag, non-greedy.
const IFRAME_REGEX = /<iframe\b[^>]*>[\s\S]*?<\/iframe>|<iframe\b[^>]*\/>/gi;

interface ParsedIframe {
    src: string;
    width?: string;
    height?: string;
    allowtransparency?: string;
    sandbox?: string;
}

// messageId -> iframes we stripped out of that message's content, so the
// accessory can still render them even though message.content no longer
// contains the raw tag.
const iframesByMessageId = new Map<string, ParsedIframe[]>();

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

const SAFE_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms";

function IframeEmbed({ src, width, height, allowtransparency, sandbox }: ParsedIframe) {
    const h = Math.min(parseInt(height || "350", 10) || 350, MAX_HEIGHT);
    const w = Math.min(parseInt(width || "500", 10) || 500, 700);

    return (
        <iframe
            src={src}
            width={w}
            height={h}
            allowTransparency={allowtransparency !== "false"}
            frameBorder={0}
            sandbox={FORCE_SANDBOX ? SAFE_SANDBOX : (sandbox || SAFE_SANDBOX)}
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

// Pulls <iframe> tags out of raw content, returns the parsed list (if any)
// and the content with those tags removed (surrounding blank lines collapsed).
function extractIframes(content: string): { parsed: ParsedIframe[]; stripped: string; } {
    const matches = content.match(IFRAME_REGEX);
    if (!matches || matches.length === 0) return { parsed: [], stripped: content };

    const parsed: ParsedIframe[] = [];
    for (const tag of matches) {
        const attrs = parseAttrs(tag);
        if (attrs.src) parsed.push(attrs as unknown as ParsedIframe);
    }

    const stripped = content
        .replace(IFRAME_REGEX, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return { parsed, stripped };
}

function processMessage(message: any) {
    if (!message || typeof message.content !== "string" || !message.content.includes("<iframe")) return;

    const { parsed, stripped } = extractIframes(message.content);
    if (parsed.length === 0) return;

    iframesByMessageId.set(message.id, parsed);
    message.content = stripped;
}

function processMessages(messages: any[] | undefined) {
    messages?.forEach(processMessage);
}

function interceptor(payload: any) {
    switch (payload?.type) {
        case "MESSAGE_CREATE":
        case "MESSAGE_UPDATE":
            processMessage(payload.message);
            break;
        case "LOAD_MESSAGES_SUCCESS":
            processMessages(payload.messages);
            break;
    }
    return false;
}

export default definePlugin({
    name: "CoreIframes",
    description: "Iframes In Messages",
    authors: [ArgonDevs.Ven],
    required: true,

    start() {
        FluxDispatcher.addInterceptor(interceptor);

        addMessageAccessory(ACCESSORY_ID, (props: { message: Message; }) => {
            const parsedList = iframesByMessageId.get(props.message.id);
            if (!parsedList || parsedList.length === 0) return null;

            return (
                <>
                    {parsedList.map((iframe, i) =>
                        isAllowedHost(iframe.src, ALLOWED_HOSTS)
                            ? <IframeEmbed key={i} {...iframe} />
                            : <BlockedEmbed key={i} src={iframe.src} />
                    )}
                </>
            );
        });
    },

    stop() {
        try {
            const interceptors = (FluxDispatcher as any)._interceptors;
            if (Array.isArray(interceptors)) {
                const idx = interceptors.indexOf(interceptor);
                if (idx !== -1) interceptors.splice(idx, 1);
            }
        } catch { /* ignore */ }

        removeMessageAccessory(ACCESSORY_ID);
        iframesByMessageId.clear();
    },
});
