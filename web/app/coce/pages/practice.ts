import { useEffect, useState } from "react";
import { loadIndex, type BankIndex, type Level } from "./deps.ts";
import type { CoceSection } from "./shared.ts";
export function useIndex() {
    const [index, setIndex] = useState<BankIndex | null | undefined>(undefined);
    useEffect(() => { let live = true; loadIndex().then((i) => live && setIndex(i)).catch(() => live && setIndex(null)); return () => { live = false; }; }, []);
    return index;
}
export const levelSize = (index: BankIndex | null | undefined, section: CoceSection, level: Level) => index?.levels?.[section]?.[level] ?? 0;
