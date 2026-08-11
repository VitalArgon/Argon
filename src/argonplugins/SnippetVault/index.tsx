import { ArgonDevs } from "@utils/constants";
import { DataStore } from "@api/index";
import { HeaderBarButton } from "@api/HeaderBar";
import { openModal, ModalRoot, ModalHeader, ModalContent, ModalCloseButton, ModalSize } from "@utils/modal";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, Forms, TextInput, useEffect, useMemo, useRef, useState } from "@webpack/common";

const DATA_KEY = "SnippetVault_snippets";

// Discord bundles highlight.js for its own message code blocks — reuse that
// instance instead of shipping our own copy. Falls back to plain text if the
// module shape ever changes upstream.
const HLJS = findByPropsLazy("highlight", "highlightAuto");

const LANGUAGES = [
    "plaintext", "javascript", "typescript", "jsx", "tsx", "python", "java",
    "csharp", "cpp", "c", "css", "scss", "html", "xml", "json", "yaml",
    "markdown", "bash", "shell", "sql", "rust", "go", "php", "ruby",
    "swift", "kotlin", "lua", "diff", "ini", "dockerfile"
];

function escapeHtml(str: string) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function highlightCode(code: string, lang: string): string {
    if (!code) return "";
    if (!HLJS?.highlight) return escapeHtml(code);
    try {
        if (lang && lang !== "plaintext" && HLJS.getLanguage?.(lang)) {
            return HLJS.highlight(code, { language: lang }).value;
        }
        if (lang === "plaintext") return escapeHtml(code);
        return HLJS.highlightAuto(code).value;
    } catch {
        return escapeHtml(code);
    }
}

interface Snippet {
    id: string;
    name: string;
    content: string;
    category: string;
    language: string;
    tags: string[];
    updatedAt: number;
}

function uid() {
    return crypto.randomUUID();
}

// Normalizes a raw record from DataStore into a well-formed Snippet.
// Older saved data (or anything written by a previous version of this
// plugin) may be missing fields like `tags` or `language` entirely —
// reading `.join`/`.some`/`.length` on `undefined` is what was crashing
// the modal on open. Every snippet is coerced through this before it
// ever reaches render or state.
function normalizeSnippet(raw: any): Snippet {
    return {
        id: typeof raw?.id === "string" ? raw.id : uid(),
        name: typeof raw?.name === "string" ? raw.name : "Untitled",
        content: typeof raw?.content === "string" ? raw.content : "",
        category: typeof raw?.category === "string" ? raw.category : "Uncategorized",
        language: typeof raw?.language === "string" ? raw.language : "plaintext",
        tags: Array.isArray(raw?.tags) ? raw.tags.filter((t: unknown) => typeof t === "string") : [],
        updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : Date.now()
    };
}

async function loadSnippets(): Promise<Snippet[]> {
    const raw = await DataStore.get(DATA_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeSnippet);
}

async function saveSnippets(snippets: Snippet[]) {
    await DataStore.set(DATA_KEY, snippets);
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
    const [draftLanguage, setDraftLanguage] = useState("plaintext");
    const [draftTags, setDraftTags] = useState("");
    const highlightRef = useRef<HTMLPreElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            setDraftLanguage(selected.language || "plaintext");
            setDraftTags((selected.tags ?? []).join(", "));
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
            const tags = s.tags ?? [];
            const tagOk = !tagFilter.trim() || tags.some(t => t.toLowerCase().includes(tagFilter.trim().toLowerCase()));
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
            language: "plaintext",
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
                    language: draftLanguage || "plaintext",
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
                                background: "var(--background-secondary, #2b2d31)",
                                color: "var(--text-normal, #dcddde)",
                                border: "1px solid var(--background-modifier-accent)",
                                borderRadius: 4,
                                padding: "6px 8px",
                                width: "100%",
                                boxSizing: "border-box",
                                fontSize: 13,
                                colorScheme: "dark"
                            }}
                        >
                            {categories.map(c => <option key={c} value={c} style={{ background: "#2b2d31", color: "#dcddde" }}>{c}</option>)}
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
                            {filtered.map(s => {
                                const tags = s.tags ?? [];
                                return (
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
                                            color: "var(--text-normal, #dcddde)",
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
                                        }}>{s.name}</div>
                                        <div style={{
                                            fontSize: 11,
                                            color: "var(--text-normal, #dcddde)",
                                            opacity: 0.6,
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis"
                                        }}>
                                            {s.category || "Uncategorized"}
                                            {s.language && s.language !== "plaintext" ? ` · ${s.language}` : ""}
                                            {tags.length > 0 ? ` · ${tags.join(", ")}` : ""}
                                        </div>
                                    </div>
                                );
                            })}
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
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <Forms.FormTitle tag="h5">Language</Forms.FormTitle>
                                        <select
                                            value={draftLanguage}
                                            onChange={e => setDraftLanguage(e.target.value)}
                                            style={{
                                                background: "var(--background-secondary, #2b2d31)",
                                                color: "var(--text-normal, #dcddde)",
                                                border: "1px solid var(--background-modifier-accent)",
                                                borderRadius: 4,
                                                padding: "6px 8px",
                                                width: "100%",
                                                boxSizing: "border-box",
                                                fontSize: 13,
                                                colorScheme: "dark"
                                            }}
                                        >
                                            {LANGUAGES.map(l => (
                                                <option key={l} value={l} style={{ background: "#2b2d31", color: "#dcddde" }}>{l}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div style={{ minWidth: 0 }}>
                                    <Forms.FormTitle tag="h5">Tags (comma separated)</Forms.FormTitle>
                                    <TextInput value={draftTags} onChange={setDraftTags} placeholder="webpack, patch, react" />
                                </div>

                                <Forms.FormTitle tag="h5" style={{ marginTop: 4, marginBottom: 0 }}>Content</Forms.FormTitle>
                                <div style={{
                                    position: "relative",
                                    flexGrow: 1,
                                    minHeight: 220,
                                    width: "100%",
                                    boxSizing: "border-box",
                                    border: "1px solid var(--background-modifier-accent)",
                                    borderRadius: 4,
                                    background: "var(--background-secondary, #2b2d31)",
                                    overflow: "hidden"
                                }}>
                                    {/* Highlighted code sits behind the textarea; the textarea itself
                                        renders transparent text on top so typing/selection/caret all
                                        still work like a normal textarea. */}
                                    <pre
                                        ref={highlightRef}
                                        aria-hidden="true"
                                        style={{
                                            margin: 0,
                                            position: "absolute",
                                            inset: 0,
                                            overflow: "hidden",
                                            pointerEvents: "none",
                                            whiteSpace: "pre-wrap",
                                            overflowWrap: "break-word",
                                            wordBreak: "break-word",
                                            fontFamily: "var(--font-code)",
                                            fontSize: 13,
                                            lineHeight: 1.5,
                                            padding: 8,
                                            color: "var(--text-normal, #dcddde)"
                                        }}
                                    >
                                        <code
                                            className={`hljs${draftLanguage && draftLanguage !== "plaintext" ? ` language-${draftLanguage}` : ""}`}
                                            dangerouslySetInnerHTML={{ __html: highlightCode(draftContent, draftLanguage) + "\n" }}
                                        />
                                    </pre>
                                    <textarea
                                        ref={textareaRef}
                                        value={draftContent}
                                        onChange={e => setDraftContent(e.target.value)}
                                        onScroll={e => {
                                            if (highlightRef.current) {
                                                highlightRef.current.scrollTop = e.currentTarget.scrollTop;
                                                highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
                                            }
                                        }}
                                        spellCheck={false}
                                        wrap="soft"
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            width: "100%",
                                            height: "100%",
                                            margin: 0,
                                            boxSizing: "border-box",
                                            resize: "none",
                                            whiteSpace: "pre-wrap",
                                            overflowWrap: "break-word",
                                            wordBreak: "break-word",
                                            overflow: "auto",
                                            fontFamily: "var(--font-code)",
                                            fontSize: 13,
                                            lineHeight: 1.5,
                                            background: "transparent",
                                            color: "transparent",
                                            caretColor: "var(--text-normal, #dcddde)",
                                            colorScheme: "dark",
                                            border: "none",
                                            borderRadius: 4,
                                            padding: 8
                                        }}
                                    />
                                </div>

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
    authors: [ArgonDevs.Zarak],
    dependencies: ["HeaderBarAPI"],

    headerBarButton: {
        icon: ToolbarIcon,
        render: ToolbarButton,
        priority: 1000
    }
});
