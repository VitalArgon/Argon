/*
 * Veil, a Discord client mod
 * Always-on: shows a purple "Veil" tag next to the specified developer account.
 * Not user-toggleable — lives in src/plugins/ like Settings/Updater.
 */

import { VeilDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { VeilIcon } from "@components/Icons"; // confirm this is where it actually lives

// Set this to your actual Discord user ID (right-click your name → Copy User ID,
// requires Developer Mode enabled in Discord's own settings).
const TARGET_USER_ID = "1212639964605718582";

function VeilTag() {
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                height: 15,
                backgroundColor: "#a259ff",
                color: "#ffffff",
                borderRadius: 3,
                padding: "0 3px",
                marginLeft: 4,
                fontSize: 10,
                fontWeight: 700,
                lineHeight: "12px",
                textTransform: "uppercase",
                verticalAlign: "middle",
            }}
        >
            <VeilIcon width={10} height={10} />
            Veil
        </span>
    );
}

export default definePlugin({
    name: "VeilTag",
    description: "Shows a purple Veil tag next to the dev's name.",
    authors: [VeilDevs.Zarak], // replace with your own { name, id } entry
    required: true,
    dependencies: ["MemberListDecoratorsAPI", "MessageDecorationsAPI", "NicknameIconsAPI"],

    renderNicknameIcon(props: { userId: string; }) {
        return props.userId === TARGET_USER_ID ? <VeilTag /> : null;
    },

    renderMessageDecoration(props: { message: { author: { id: string; }; }; }) {
        return props.message.author.id === TARGET_USER_ID ? <VeilTag /> : null;
    },

    renderMemberListDecorator(props: { user: { id: string; }; }) {
        return props.user.id === TARGET_USER_ID ? <VeilTag /> : null;
    },
});
