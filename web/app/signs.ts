const UNTRUSTED_AFTER = 3;
const NO_INPUT_AFTER = 30;
let untrusted = 0, trusted = 0, writes = 0, installed = false;
function watch() {
    if (installed || typeof document === "undefined")
        return;
    installed = true;
    const seen = (e: Event) => { if (e.isTrusted)
        trusted++;
    else if (e.type !== "click")
        untrusted++; };
    for (const type of ["pointerdown", "mousedown", "touchstart", "keydown", "wheel", "click"])
        document.addEventListener(type, seen, { capture: true, passive: true });
}
export function countWrite() { writes++; }
export function clues(): string {
    watch();
    const out: string[] = [];
    try {
        if (navigator.webdriver === true)
            out.push("w");
        if (/Headless/i.test(navigator.userAgent))
            out.push("h");
    }
    catch { }
    if (untrusted >= UNTRUSTED_AFTER)
        out.push("u");
    if (writes >= NO_INPUT_AFTER && trusted === 0)
        out.push("n");
    return out.join(",");
}
export const resetClues = () => { untrusted = 0; trusted = 0; writes = 0; };
