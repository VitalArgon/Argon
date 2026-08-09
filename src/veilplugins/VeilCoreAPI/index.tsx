// not adding notes because if you're snooping through this you should be able to al least guess what it does
import definePlugin from "@utils/types";
import { VeilDevs, Devs, EquicordDevs } from "@utils/constants";
import {
    React, Modal, openModal, showToast,
    FluxDispatcher, UserStore, ChannelStore, GuildStore,
    SelectedChannelStore, GuildMemberStore, ReactDOM, createRoot,
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

    // Respect the provided root instead of always scanning the whole document.
    scan(root);

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

/**
 * Render a React element to DOM in a safe React renderer context and return the
 * resulting DOM node (first child) or a text node when rendering produced only text.
 * Uses createRoot + ReactDOM.flushSync to avoid calling component functions
 * (and hooks) outside of React's render cycle — this prevents random crashes
 * caused by invalid hook calls.
 */
export function renderReactToDom(element: any): Node | null {
    try {
        const container = document.createElement("div");
        const root = createRoot(container);
        // flushSync ensures synchronous rendering so callers immediately get DOM.
        ReactDOM.flushSync(() => root.render(element));
        const child = container.firstChild;
        root.unmount();
        if (child) return child;
        return document.createTextNode(container.textContent ?? "");
    } catch (e) {
        // If React rendering fails for any reason, fall back to a conservative
        // attempt that will not execute hooks: attempt to stringify.
        try {
            return document.createTextNode(String(element));
        } catch {
            return null;
        }
    }
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

        // If this is a React component (function/class), render it via React
        // instead of invoking the function directly — that avoids invalid
        // hook calls when the component uses hooks.
        if (typeof type === "function") {
            try {
                const element = React.createElement(type, props ?? {});
                return renderReactToDom(element);
            } catch (e) {
                // As a last resort, try calling it directly (best-effort).
                try {
                    return reactNodeToDom(type(props ?? {}));
                } catch {
                    return null;
                }
            }
        }

        if (typeof type === "string") {
            // Create an SVG element only when the tag is an SVG tag (root svg)
            // or when xmlns explicitly requests SVG. This avoids creating html
            // elements in the SVG namespace which can cause subtle DOM issues.
            const isSvg = type === "svg" || (props && props.xmlns === SVG_NS);
            const el = isSvg ? document.createElementNS(SVG_NS, type) : document.createElement(type);

            for (const [key, value] of Object.entries(props ?? {})) {
                if (key === "children" || key === "key" || key === "ref") continue;
                if (value === undefined || value === null || value === false) continue;
                if (key === "style" && typeof value === "object") {
                    Object.assign((el as any).style, value);
                    continue;
                }
                // Handle className separately for consistency
                if (key === "className") {
                    (el as HTMLElement).className = String(value);
                    continue;
                }
                // Use appropriate attribute naming for SVG/hyphenation
                try {
                    el.setAttribute(svgAttrName(key), String(value));
                } catch {
                    // ignore attributes that fail to set
                }
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
        const ctx = this as any;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(ctx, args), ms);
    }) as T;
}

export default definePlugin({
    name: "VeilCoreAPI",
    description: "Shared helpers for building Veil plugins (style injection, DOM observing, modals, plugin/dev lookups, icon rendering, logging, toasts, common stores, Flux events, context menus,[...]",
    authors: [VeilDevs.Zarak],
    required: true,
    dependencies: ["ContextMenuAPI", "MessageEventsAPI"],
});
