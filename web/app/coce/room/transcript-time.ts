export type LineTime = {
    chars: number;
    span: [
        number,
        number
    ] | null;
};
export function lineSpans(lines: LineTime[], duration: number): [
    number,
    number
][] {
    const out: [
        number,
        number
    ][] = lines.map((l) => (l.span ? [l.span[0], l.span[1]] : [0, 0]));
    let i = 0;
    while (i < lines.length) {
        if (lines[i].span) {
            i++;
            continue;
        }
        let j = i;
        while (j < lines.length && !lines[j].span)
            j++;
        const from = i > 0 ? out[i - 1][1] : 0;
        const to = j < lines.length ? out[j][0] : Math.max(from, duration || from);
        const total = lines.slice(i, j).reduce((a, l) => a + Math.max(1, l.chars), 0);
        let at = from;
        for (let k = i; k < j; k++) {
            const len = ((to - from) * Math.max(1, lines[k].chars)) / total;
            out[k] = [at, at + len];
            at += len;
        }
        i = j;
    }
    return out;
}
export function wordStart(span: [
    number,
    number
], offset: number, chars: number): number {
    return span[0] + (span[1] - span[0]) * (chars > 0 ? Math.min(1, offset / chars) : 0);
}
