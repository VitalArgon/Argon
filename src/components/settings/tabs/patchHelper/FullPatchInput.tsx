/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Paragraph } from "@components/Paragraph";
import { Patch, ReplaceFn } from "@utils/types";
import { TextArea, useEffect, useRef, useState } from "@webpack/common";

export interface FullPatchInputProps {
    setFind(v: string): void;
    setParsedFind(v: string | RegExp): void;
    setMatch(v: string): void;
    setReplacement(v: string | ReplaceFn): void;
}

export function FullPatchInput({ setFind, setParsedFind, setMatch, setReplacement }: FullPatchInputProps) {
    const [patch, setPatch] = useState<string>("");
    const [error, setError] = useState<string>("");
    const textAreaRef = useRef<HTMLTextAreaElement>(null);
    const hasEdits = useRef(false);

    function clearValues() {
        setFind("");
        setParsedFind("");
        setMatch("");
        setReplacement("");
    }

    function update() {
        if (!hasEdits.current) return;
        hasEdits.current = false;

        if (patch.trim() === "") {
            setError("");
            clearValues();
            return;
        }

        try {
            const { find, replacement } = (0, eval)(`([${patch}][0])`) as Patch;
            if (!find || (typeof find !== "string" && !(find instanceof RegExp))) {
                throw new Error("Expected a string or RegExp in 'find'");
            }

            const replacements = Array.isArray(replacement) ? replacement : [replacement];
            const firstReplacement = replacements[0];
            if (!firstReplacement) throw new Error("No replacements to test");
            if (typeof firstReplacement.match !== "string" && !(firstReplacement.match instanceof RegExp)) {
                throw new Error("Expected a string or RegExp in 'replacement.match'");
            }
            if (typeof firstReplacement.replace !== "string" && typeof firstReplacement.replace !== "function") {
                throw new Error("Expected a string or function in 'replacement.replace'");
            }

            setFind(find instanceof RegExp ? `/${find.source}/` : find);
            setParsedFind(find);
            setMatch(firstReplacement.match instanceof RegExp ? firstReplacement.match.source : firstReplacement.match);
            setReplacement(firstReplacement.replace);
            setError("");
        } catch (e) {
            clearValues();
            setError((e as Error).message);
        }
    }

    useEffect(() => {
        const { current: textArea } = textAreaRef;
        if (textArea) {
            textArea.style.height = "auto";
            textArea.style.height = `${Math.min(textArea.scrollHeight, 224)}px`;
        }
    }, [patch]);

    return (
        <>
            <Paragraph>Paste a full patch here. Only the first replacement is used by this input.</Paragraph>
            <TextArea
                aria-label="Full patch"
                rows={4}
                inputRef={textAreaRef}
                value={patch}
                onChange={value => {
                    hasEdits.current = true;
                    setPatch(value);
                }}
                onBlur={update}
            />
            {error !== "" && <Paragraph style={{ color: "var(--text-feedback-critical)" }}>{error}</Paragraph>}
        </>
    );
}
