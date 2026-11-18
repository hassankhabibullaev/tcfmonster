import { wordCount } from "./types";
export const MAX_WORDS = 3000;
export function capWords(text: string, max = MAX_WORDS): string {
    if (wordCount(text) <= max)
        return text;
    const m = text.match(new RegExp(`^\\s*(?:\\S+\\s+){${max - 1}}\\S+`));
    return m ? m[0] : text;
}
