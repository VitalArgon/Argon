/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ArgonDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import { createStyleInjector } from "../ArgonCoreAPI";

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

const injector = createStyleInjector(STYLE_ID, CSS);

export default definePlugin({
    name: "ThreadHider",
    tags: ["Argon"],
    description: "Hides channel threads and shows them upon hovering over the channel",
    authors: [ArgonDevs.Zarak],

    start() {
        injector.inject();
    },

    stop() {
        injector.remove();
    },
});
