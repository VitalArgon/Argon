import { VeilDevs } from "@utils/constants";
import { DataStore } from "@api/index";
import { HeaderBarButton } from "@api/HeaderBar";
import { openModal, ModalRoot, ModalHeader, ModalContent, ModalCloseButton, ModalSize } from "@utils/modal";
import definePlugin from "@utils/types";
import { Button, Forms, TextInput, useEffect, useMemo, useState } from "@webpack/common";

const DATA_KEY = "SnippetVault_snippets";

interface Snippet {
    id: string;
    name: string;
    content: string;
    category: string;
    tags: string[];
    updatedAt: number;
}

async function loadSnippets(): Promise<Snippet[]> {
    return (await DataStore.get(DATA_KEY)) ?? [];
}

async function saveSnippets(snippets: Snippet[]) {
    await DataStore.set(DATA_KEY, snippets);
}

function uid() {
    return crypto.randomUUID();
}

function ToolbarIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
            {...props}
        >
            <path
                fill="currentColor"
                d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h9.5a1 1 0 0 0 .7-.29l4.5-4.5a1 1 0 0 0 .3-.71V4a2 2 0 0 0-2-2H6Zm0 2h12v12h-3.5a1.5 1.5 0 0 0-1.5 1.5V20H6V4Zm2 3a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H8Zm0 4a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H8Z"
            />
        </svg>
    );
}

function SnippetVaultModal({ modalProps }: { modalProps: any; }) {
    const [snippets, setSnippets] = useState<Snippet[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<string>("All");
    const [tagFilter, setTagFilter] = useState<string>("");
    const [renaming, setRenaming] = useState(false);
    const [draftName, setDraftName] = useState("");
    const [draftContent, setDraftContent] = useState("");
    const [draftCategory, setDraftCategory] = useState("");
    const [draftTags, setDraftTags] = useState("");

    useEffect(() => {
        loadSnippets().then(s => {
            setSnippets(s);
            setLoaded(true);
            if (s.length) setSelectedId(s[0].id);
        });
    }, []);

    const selected = useMemo(
        () => snippets.find(s => s.id === selectedId) ?? null,
        [snippets, selectedId]
    );

    useEffect(() => {
        if (selected) {
            setDraftName(selected.name);
            setDraftContent(selected.content);
            setDraftCategory(selected.category);
            setDraftTags(selected.tags.join(", "));
            setRenaming(false);
        }
    }, [selectedId]);

    const categories = useMemo(() => {
        const set = new Set(snippets.map(s => s.category || "Uncategorized"));
        return ["All", ...Array.from(set)];
    }, [snippets]);

    const filtered = useMemo(() => {
        return snippets.filter(s => {
            const catOk = categoryFilter === "All" || (s.category || "Uncategorized") === categoryFilter;
            const tagOk = !tagFilter.trim() || s.tags.some(t => t.toLowerCase().includes(tagFilter.trim().toLowerCase()));
            return catOk && tagOk;
        });
    }, [snippets, categoryFilter, tagFilter]);

    async function persist(next: Snippet[]) {
        setSnippets(next);
        await saveSnippets(next);
    }

    async function addSnippet() {
        const s: Snippet = {
            id: uid(),
            name: "New Snippet",
            content: "",
            category: "Uncategorized",
            tags: [],
            updatedAt: Date.now()
        };
        const next = [s, ...snippets];
        await persist(next);
        setSelectedId(s.id);
        setRenaming(true);
    }

    async function deleteSnippet(id: string) {
        const next = snippets.filter(s => s.id !== id);
        await persist(next);
        if (selectedId === id) setSelectedId(next[0]?.id ?? null);
    }

    async function saveDraft() {
        if (!selected) return;
        const next = snippets.map(s =>
            s.id === selected.id
                ? {
                    ...s,
                    name: draftName.trim() || "Untitled",
                    content: draftContent,
                    category: draftCategory.trim() || "Uncategorized",
                    tags: draftTags
                        .split(",")
                        .map(t => t.trim())
                        .filter(Boolean),
                    updatedAt: Date.now()
                }
                : s
        );
        await persist(next);
        setRenaming(false);
    }

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Forms.FormTitle tag="h4" style={{ flexGrow: 1 }}>Snippet Vault</Forms.FormTitle>
                <ModalCloseButton onClick={modalProps.onClose} />
            </ModalHeader>
            <ModalContent>
                <div style={{ display: "flex", gap: 12, padding: "16px 0", minHeight: 420, maxHeight: "70vh" }}>
                    {/* Sidebar */}
                    <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                        <Button size={Button.Sizes.SMALL} onClick={addSnippet}>+ New Snippet</Button>

                        <Forms.FormTitle tag="h5" style={{ marginTop: 8, marginBottom: 4 }}>Category</Forms.FormTitle>
                        <select
                            value={categoryFilter}
                            onChange={e => setCategoryFilter(e.target.value)}
                            style={{
                                background: "var(--background-secondary)",
                                color: "var(--text-normal)",
                                border: "1px solid var(--background-modifier-accent)",
                                borderRadius: 4,
                                padding: "6px 8px",
                                width: "100%",
                                boxSizing: "border-box",
                                fontSize: 13
                            }}
                        >
                            {categories.map(c => <option key={c} value={c} style={{ background: "var(--background-secondary)", color: "var(--text-normal)" }}>{c}</option>)}
                        </select>

                        <Forms.FormTitle tag="h5" style={{ marginTop: 8, marginBottom: 4 }}>Filter by tag</Forms.FormTitle>
                        <TextInput
                            value={tagFilter}
                            onChange={setTagFilter}
                            placeholder="e.g. webpack"
                        />

                        <div style={{ marginTop: 8, overflowY: "auto", overflowX: "hidden", flexGrow: 1, minHeight: 0, borderTop: "1px solid var(--background-modifier-accent)" }}>
                            {!loaded && <Forms.FormText style={{ padding: 8 }}>Loading…</Forms.FormText>}
                            {loaded && filtered.length === 0 && (
                                <Forms.FormText style={{ padding: 8, opacity: 0.7 }}>No snippets yet.</Forms.FormText>
                            )}
                            {filtered.map(s => (
                                <div
                                    key={s.id}
                                    onClick={() => setSelectedId(s.id)}
                                    style={{
                                        padding: "8px 6px",
                                        borderRadius: 4,
                                        cursor: "pointer",
                                        background: s.id === selectedId ? "var(--background-modifier-selected)" : "transparent"
                                    }}
                                >
                                    <div style={{
                                        fontWeight: 600,
                                        fontSize: 14,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis"
                                    }}>{s.name}</div>
                                    <div style={{
                                        fontSize: 11,
                                        opacity: 0.6,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis"
                                    }}>
                                        {s.category || "Uncategorized"}
                                        {s.tags.length > 0 ? ` · ${s.tags.join(", ")}` : ""}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Editor pane */}
                    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                        {!selected && (
                            <Forms.FormText style={{ margin: "auto", opacity: 0.6 }}>
                                Select a snippet, or create a new one.
                            </Forms.FormText>
                        )}

                        {selected && (
                            <>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                                    {renaming ? (
                                        <TextInput
                                            value={draftName}
                                            onChange={setDraftName}
                                            autoFocus
                                            style={{ flexGrow: 1, minWidth: 0 }}
                                        />
                                    ) : (
                                        <Forms.FormTitle tag="h3" style={{
                                            flexGrow: 1,
                                            minWidth: 0,
                                            margin: 0,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
                                        }}>{selected.name}</Forms.FormTitle>
                                    )}
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => setRenaming(r => !r)}>
                                        {renaming ? "Done" : "Rename"}
                                    </Button>
                                    <Button
                                        size={Button.Sizes.SMALL}
                                        color={Button.Colors.RED}
                                        onClick={() => deleteSnippet(selected.id)}
                                    >
                                        Delete
                                    </Button>
                                </div>

                                <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <Forms.FormTitle tag="h5">Category</Forms.FormTitle>
                                        <TextInput value={draftCategory} onChange={setDraftCategory} placeholder="Uncategorized" />
                                    </div>
                                    <div style={{ flex: 2, minWidth: 0 }}>
                                        <Forms.FormTitle tag="h5">Tags (comma separated)</Forms.FormTitle>
                                        <TextInput value={draftTags} onChange={setDraftTags} placeholder="webpack, patch, react" />
                                    </div>
                                </div>

                                <Forms.FormTitle tag="h5" style={{ marginTop: 4, marginBottom: 0 }}>Content</Forms.FormTitle>
                                <textarea
                                    value={draftContent}
                                    onChange={e => setDraftContent(e.target.value)}
                                    spellCheck={false}
                                    wrap="soft"
                                    style={{
                                        flexGrow: 1,
                                        minHeight: 220,
                                        width: "100%",
                                        maxWidth: "100%",
                                        boxSizing: "border-box",
                                        resize: "vertical",
                                        whiteSpace: "pre-wrap",
                                        overflowWrap: "break-word",
                                        wordBreak: "break-word",
                                        overflowX: "hidden",
                                        overflowY: "auto",
                                        fontFamily: "var(--font-code)",
                                        fontSize: 13,
                                        lineHeight: 1.5,
                                        background: "var(--background-secondary)",
                                        color: "var(--text-normal)",
                                        border: "1px solid var(--background-modifier-accent)",
                                        borderRadius: 4,
                                        padding: 8
                                    }}
                                />

                                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <Button
                                        size={Button.Sizes.SMALL}
                                        onClick={() => navigator.clipboard.writeText(draftContent)}
                                    >
                                        Copy
                                    </Button>
                                    <Button size={Button.Sizes.SMALL} color={Button.Colors.GREEN} onClick={saveDraft}>
                                        Save
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </ModalContent>
        </ModalRoot>
    );
}

function openVault() {
    openModal(modalProps => <SnippetVaultModal modalProps={modalProps} />);
}

function ToolbarButton() {
    return (
        <HeaderBarButton
            className="vc-snippet-vault-btn"
            onClick={openVault}
            tooltip="Snippet Vault"
            icon={ToolbarIcon}
        />
    );
}

export default definePlugin({
    name: "SnippetVault",
    description: "Save, tag, categorize, and rename text/code snippets from a toolbar button next to Help/Inbox.",
    authors: [VeilDevs.Zarak],
    dependencies: ["HeaderBarAPI"],

    headerBarButton: {
        icon: ToolbarIcon,
        render: ToolbarButton,
        priority: 1000
    }
});
