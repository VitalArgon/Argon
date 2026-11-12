/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// not adding notes because if you're snooping through this you should be able to al least guess what it does
import { addContextMenuPatch, findGroupChildrenByChildId,removeContextMenuPatch } from "@api/ContextMenu";
import {
    addMessagePreEditListener as addPreEditListener,
    addMessagePreSendListener as addPreSendListener,
    removeMessagePreEditListener as removePreEditListener,
    removeMessagePreSendListener as removePreSendListener } from "@api/MessageEvents";
import { ArgonDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import {
ChannelStore, createRoot,
    FluxDispatcher, GuildMemberStore, GuildStore,
Modal, openModal, React, ReactDOM, SelectedChannelStore, showToast,
UserStore, } from "@webpack/common";

import Plugins, { PluginMeta } from "~plugins";

export function h(type: any, props?: any, ...children: any[]) {
    return React.createElement(type, props, ...children);
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

function SimpleModal({ modalProps, title, render }: { modalProps: any; title: string; render: (props: any) => any; }) {
    return (
        <Modal {...modalProps} title={title}>
            {render(modalProps)}
        </Modal>
    );
}

export function openSimpleModal(
    title: string,
    render: (modalProps: any) => any
) {
    openModal(modalProps => <SimpleModal modalProps={modalProps} title={title} render={render} />);
}

export function findPluginByName(rawName: string) {
    const name = rawName.trim().replace(/^"(.*)"$/, "$1");
    return (
        Plugins[name] ??
        Object.values(Plugins).find(p => p.name.toLowerCase() === name.toLowerCase())
    );
}

export { PluginMeta,Plugins };

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

export function renderReactToDom(element: any): Node | null {
    try {
        const container = document.createElement("div");
        const root = createRoot(container);
        ReactDOM.flushSync(() => root.render(element));
        const child = container.firstChild;
        root.unmount();
        if (child) return child;
        return document.createTextNode(container.textContent ?? "");
    } catch (e) {
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

        if (typeof type === "function") {
            try {
                const element = React.createElement(type, props ?? {});
                return renderReactToDom(element);
            } catch (e) {
                try {
                    return reactNodeToDom(type(props ?? {}));
                } catch {
                    return null;
                }
            }
        }

        if (typeof type === "string") {
            const isSvg = type === "svg" || (props && props.xmlns === SVG_NS);
            const el = isSvg ? document.createElementNS(SVG_NS, type) : document.createElement(type);

            for (const [key, value] of Object.entries(props ?? {})) {
                if (key === "children" || key === "key" || key === "ref") continue;
                if (value === undefined || value === null || value === false) continue;
                if (key === "style" && typeof value === "object") {
                    Object.assign((el as any).style, value);
                    continue;
                }
                if (key === "className") {
                    (el as HTMLElement).className = String(value);
                    continue;
                }
                try {
                    el.setAttribute(svgAttrName(key), String(value));
                } catch {
                }
            }
            const childDom = reactNodeToDom(props?.children);
            if (childDom) el.appendChild(childDom);
            return el;
        }
    }
    return null;
}

export function mountReactChild(container: Element, element: any): () => void {
    const root = createRoot(container);
    ReactDOM.flushSync(() => root.render(element));
    return () => root.unmount();
}

export function createLogger(name: string, color = "#A259FF") {
    return new Logger(name, color);
}

export { showToast };

export function notifyRestartNeeded() {
    showToast({ text: "Restart to apply changes!" });
}

export function copyToClipboard(text: string, toastMessage = "Copied!") {
    navigator.clipboard
        .writeText(text)
        .then(() => showToast({ text: toastMessage }))
        .catch(e => createLogger("ArgonCoreAPI").error("Failed to copy to clipboard", e));
}

export { ChannelStore, GuildMemberStore,GuildStore, SelectedChannelStore, UserStore };

export function subscribeFlux(event: string, handler: (payload: any) => void) {
    FluxDispatcher.subscribe(event, handler);
    return () => FluxDispatcher.unsubscribe(event, handler);
}

export { addContextMenuPatch, findGroupChildrenByChildId,removeContextMenuPatch };
export { addPreEditListener, addPreSendListener, removePreEditListener,removePreSendListener };

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastArgs: any[] | undefined;
    let lastThis: any;

    function debounced(this: any, ...args: any[]) {
        lastArgs = args;
        lastThis = this;
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            fn.apply(lastThis, lastArgs as any[]);
        }, ms);
    }

    debounced.cancel = () => {
        clearTimeout(timer);
        timer = undefined;
    };

    debounced.flush = () => {
        if (timer === undefined) return;
        clearTimeout(timer);
        timer = undefined;
        fn.apply(lastThis, lastArgs as any[]);
    };

    return debounced as T & { cancel(): void; flush(): void; };
}

export function throttle<T extends (...args: any[]) => void>(
    fn: T,
    ms: number,
    opts: { trailing?: boolean; } = {}
) {
    let lastCall = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastArgs: any[] | undefined;
    let lastThis: any;

    function throttled(this: any, ...args: any[]) {
        const now = Date.now();
        const remaining = ms - (now - lastCall);
        lastArgs = args;
        lastThis = this;

        if (remaining <= 0) {
            lastCall = now;
            fn.apply(this, args);
        } else if (opts.trailing && timer === undefined) {
            timer = setTimeout(() => {
                lastCall = Date.now();
                timer = undefined;
                fn.apply(lastThis, lastArgs as any[]);
            }, remaining);
        }
    }

    throttled.cancel = () => {
        clearTimeout(timer);
        timer = undefined;
    };

    return throttled as T & { cancel(): void; };
}

export function once<T extends (...args: any[]) => any>(fn: T): T {
    let called = false;
    let result: ReturnType<T>;
    return ((...args: any[]) => {
        if (!called) {
            called = true;
            result = fn(...args);
        }
        return result;
    }) as T;
}

export function memoize<T extends (...args: any[]) => any>(fn: T): T {
    const cache = new Map<string, ReturnType<T>>();
    return ((...args: any[]) => {
        const key = JSON.stringify(args);
        if (cache.has(key)) return cache.get(key)!;
        const result = fn(...args);
        cache.set(key, result);
        return result;
    }) as T;
}

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function waitFor<T>(
    check: () => T | null | undefined | false,
    { interval = 50, timeout = 10_000 }: { interval?: number; timeout?: number; } = {}
): Promise<T> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            const value = check();
            if (value) return resolve(value);
            if (Date.now() - start >= timeout) return reject(new Error("waitFor timed out"));
            setTimeout(tick, interval);
        };
        tick();
    });
}

export class EventBus<Events extends Record<string, any> = Record<string, any>> {
    private listeners = new Map<keyof Events, Set<(payload: any) => void>>();

    on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(handler);
        return () => this.off(event, handler);
    }

    off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): void {
        this.listeners.get(event)?.delete(handler);
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]): void {
        this.listeners.get(event)?.forEach(handler => {
            try {
                handler(payload);
            } catch (e) {
                createLogger("ArgonCoreAPI").error(`EventBus handler for "${String(event)}" threw`, e);
            }
        });
    }

    clear(): void {
        this.listeners.clear();
    }
}

const LEGACY_STORAGE_PREFIX = "veil-";
const STORAGE_PREFIX = "argon-";

export function createSimpleStore<T>(key: string, defaultValue: T) {
    const storageKey = `${STORAGE_PREFIX}${key}`;
    const legacyKey = `${LEGACY_STORAGE_PREFIX}${key}`;
    return {
        get(): T {
            try {
                // Values written before the rename still live under veil-*.
                const raw = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyKey);
                return raw ? (JSON.parse(raw) as T) : defaultValue;
            } catch {
                return defaultValue;
            }
        },
        set(value: T): void {
            try {
                localStorage.setItem(storageKey, JSON.stringify(value));
            } catch (e) {
                createLogger("ArgonCoreAPI").error(`Failed to persist store "${key}"`, e);
            }
        },
        clear(): void {
            localStorage.removeItem(storageKey);
        },
    };
}

export function wrapMethod<O extends object, K extends keyof O>(
    obj: O,
    key: K,
    hooks: {
        before?: (args: any[]) => void;
        after?: (result: any, args: any[]) => void;
        onError?: (err: unknown, args: any[]) => void;
    }
): () => void {
    const original = obj[key] as unknown as (...args: any[]) => any;
    if (typeof original !== "function") {
        throw new Error(`wrapMethod: "${String(key)}" is not a function`);
    }

    (obj[key] as unknown as (...args: any[]) => any) = function (this: any, ...args: any[]) {
        hooks.before?.(args);
        try {
            const result = original.apply(this, args);
            hooks.after?.(result, args);
            return result;
        } catch (err) {
            hooks.onError?.(err, args);
            throw err;
        }
    };

    return () => {
        (obj[key] as unknown as (...args: any[]) => any) = original;
    };
}

export default definePlugin({
    name: "ArgonCoreAPI",
    description: "Shared helpers for building Argon plugins (style injection, DOM observing, modals, plugin/dev lookups, icon rendering, logging, toasts, common stores, Flux events, context menus, debounce/throttle/once/memoize, waitFor, a lightweight EventBus, simple localStorage-backed stores, managed React child mounting, and method wrapping).",
    authors: [ArgonDevs.Zarak],
    required: true,
    dependencies: ["ContextMenuAPI", "MessageEventsAPI"],
});
