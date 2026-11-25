
import definePlugin from "@utils/types";

const STYLE_ID = "argon-quick-delete-style";
const BUTTON_CLASS = "argon-quick-delete-button";

let observer: MutationObserver | undefined;
let hoveredRow: HTMLElement | null = null;
let altPressed = false;

function getChannelId(row: HTMLElement): string | null {
    const item = row.closest<HTMLElement>(
        '[data-list-item-id^="channels___"]'
    );

    const id = item?.getAttribute("data-list-item-id")
        ?.replace("channels___", "");

    return id && /^\d+$/.test(id) ? id : null;
}

function removeButton() {
    hoveredRow?.querySelector(`.${BUTTON_CLASS}`)?.remove();
    hoveredRow = null;
}

function updateButton(row: HTMLElement) {
    if (!altPressed) return;

    const channelId = getChannelId(row);
    if (!channelId) return;

    if (hoveredRow !== row) removeButton();
    hoveredRow = row;

    if (row.querySelector(`.${BUTTON_CLASS}`)) return;

    const button = document.createElement("button");
    button.className = BUTTON_CLASS;
    button.title = "Delete channel";
    button.setAttribute("aria-label", "Delete channel");

    button.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18"
            fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M3 6h18"/>
            <path d="M8 6V4h8v2"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v5M14 11v5"/>
        </svg>
    `;

    button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        if (!altPressed) return;

        button.disabled = true;

        try {
            const response = await fetch(
                `/api/v10/channels/${channelId}`,
                {
                    method: "DELETE",
                    credentials: "include"
                }
            );

            if (!response.ok) {
                throw new Error(`Delete failed: ${response.status}`);
            }

            removeButton();
        } catch (error) {
            console.error("[QuickDelete]", error);
            button.disabled = false;
        }
    });

    row.appendChild(button);
}

function handlePointerMove(event: PointerEvent) {
    if (!altPressed) return;

    const target = event.target;
    if (!(target instanceof Element)) return;

    const row = target.closest<HTMLElement>(
        '[data-list-item-id^="channels___"]'
    );

    if (row) updateButton(row);
    else removeButton();
}

function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Alt") altPressed = true;
}

function handleKeyUp(event: KeyboardEvent) {
    if (event.key === "Alt") {
        altPressed = false;
        removeButton();
    }
}

function handleWindowBlur() {
    altPressed = false;
    removeButton();
}

export default definePlugin({
    name: "QuickDelete",
    description: "Hold Alt and hover over a channel to instantly delete it.",
    authors: [{ name: "Zarak" }],
    tags: ["Utility", "Servers"],

    start() {
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            .${BUTTON_CLASS} {
                position: absolute;
                right: 8px;
                top: 50%;
                transform: translateY(-50%);
                display: flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border: none;
                border-radius: 5px;
                background: transparent;
                color: var(--interactive-normal);
                cursor: pointer;
                z-index: 20;
            }

            .${BUTTON_CLASS}:hover {
                color: var(--status-danger);
                background: var(--background-modifier-hover);
            }

            .${BUTTON_CLASS}:disabled {
                opacity: 0.5;
                cursor: wait;
            }
        `;

        document.head.appendChild(style);

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("keyup", handleKeyUp);
        document.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("blur", handleWindowBlur);

        observer = new MutationObserver(() => {
            if (!altPressed || !hoveredRow?.isConnected) {
                removeButton();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    },

    stop() {
        observer?.disconnect();
        observer = undefined;

        document.removeEventListener("keydown", handleKeyDown);
        document.removeEventListener("keyup", handleKeyUp);
        document.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("blur", handleWindowBlur);

        document.getElementById(STYLE_ID)?.remove();
        document.querySelectorAll(`.${BUTTON_CLASS}`)
            .forEach(button => button.remove());

        hoveredRow = null;
        altPressed = false;
    }
});
