// not adding notes because if you're snooping through this you should be able to al least guess what it does
import definePlugin from "@utils/types";
import { VeilDevs, Devs, EquicordDevs } from "@utils/constants";
import {
    React, Modal, openModal, showToast,
    FluxDispatcher, UserStore, ChannelStore, GuildStore,
    SelectedChannelStore, GuildMemberStore,
} from "@webpack/common";
import Plugins, { PluginMeta } from "~plugins";
import { Logger } from "@utils/Logger";
import { addContextMenuPatch, removeContextMenuPatch, findGroupChildrenByChildId } from "@api/ContextMenu";
import { addPreSendListener, removePreSendListener, addPreEditListener, removePreEditListener } from "@api/MessageEvents";

export function h(...args: Parameters<typeof React.createElement>) {
    return React.createElement(...args);
}

export function createStyleInjector(id: string, css: string) {
    return {
        inject() {
            if (document.getElementById(id)) return;
            const style = document.createElement("style");
            style.id = id;
            style.textContent = css;
            document.head.appendChild(style);
        },
        remove() {
            document.getElementById(id)?.remove();
        },
    };
}

export function observeMatches(
    selector: string,
    onMatch: (el: Element) => void,
    root: Element = document.body
) {
    const scan = (r: ParentNode) => {
        r.querySelectorAll?.(selector).forEach(onMatch);
    };

    scan(document);

    const observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof Element)) return;
                if (node.matches(selector)) onMatch(node);
                else scan(node);
            });
        }
    });

    observer.observe(root, { childList: true, subtree: true });

    return () => observer.disconnect();
}

export function openSimpleModal(
    title: string,
    render: (modalProps: any) => any
) {
    openModal(modalProps =>
        h(Modal, { ...modalProps, title }, render(modalProps))
    );
}

export function findPluginByName(rawName: string) {
    const name = rawName.trim().replace(/^"(.*)"$/, "$1");
    return (
        Plugins[name] ??
        Object.values(Plugins).find(p => p.name.toLowerCase() === name.toLowerCase())
    );
}

export { Plugins, PluginMeta };

const DEV_SOURCES: Record<string, Record<string, { id: string | bigint; name: string }>> = {
    Devs, VeilDevs, EquicordDevs,
};

export function findDevEntry(userId: string) {
    for (const source of Object.values(DEV_SOURCES)) {
        for (const entry of Object.values(source)) {
            if (String(entry.id) === userId) return entry;
        }
    }
    return null;
}

export function isDev(userId: string): boolean {
    return findDevEntry(userId) !== null;
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

export function reactNodeToDom(node: any): Node | null {
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

export function createLogger(name: string, color = "#A259FF") {
    return new Logger(name, color);
}

export { showToast };

export function notifyRestartNeeded() {
    showToast("Restart to apply changes!");
}

export function copyToClipboard(text: string, toastMessage = "Copied!") {
    navigator.clipboard.writeText(text).then(() => showToast(toastMessage));
}

export { UserStore, ChannelStore, GuildStore, SelectedChannelStore, GuildMemberStore };

export function subscribeFlux(event: string, handler: (payload: any) => void) {
    FluxDispatcher.subscribe(event, handler);
    return () => FluxDispatcher.unsubscribe(event, handler);
}

export { addContextMenuPatch, removeContextMenuPatch, findGroupChildrenByChildId };
export { addPreSendListener, removePreSendListener, addPreEditListener, removePreEditListener };

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return ((...args: any[]) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    }) as T;
}

export default definePlugin({
    name: "VeilCoreAPI",
    description: "Shared helpers for building Veil plugins (style injection, DOM observing, modals, plugin/dev lookups, icon rendering, logging, toasts, common stores, Flux events, context menus, message interception). Other plugins depend on this via dependencies: [\"VeilCoreAPI\"].",
    authors: [VeilDevs.Zarak],
    required: true,
    dependencies: ["ContextMenuAPI", "MessageEventsAPI"],
});
