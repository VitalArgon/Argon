import definePlugin from "@utils/types";
import { VeilDevs } from "@utils/constants";

const STYLE_ID = "thread-hider-styles";

const CSS = `
[class*=containerDefault_][data-dnd-name]:hover+[class*=container_]:has([class*=spineBorder_]),
[class*=containerDefault_][data-dnd-name]+[class*=container_]:has([class*=spineBorder_], li[class*=container_]):hover {
    max-height: max-content;
    transition: max-height 1s ease;
}
[class*=containerDefault_][data-dnd-name]+[class*=container_]:has([class*=spineBorder_], li[class*=container_]) {
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.25s ease;
}
`;

function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

export default definePlugin({
    name: "ThreadHider",
    tags: ["Veil"],
    description: "Hides channel threads and shows them upon hovering over the channel",
    authors: [VeilDevs.Zarak],

    start() {
        injectStyles();
    },

    stop() {
        document.getElementById(STYLE_ID)?.remove();
    },
});
