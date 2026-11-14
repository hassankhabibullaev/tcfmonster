import { api } from "./api.ts";
import { noteServerDate } from "./coce/room/hooks.ts";
const KEY = "tcfm-cache";
export const HOUR = 60 * 60000;
export const BUNDLE = ["/attempts?section=co", "/attempts?section=ce", "/progress?section=co", "/progress?section=ce", "/expr/sessions", "/mock/list"] as const;
export type BundleKey = (typeof BUNDLE)[number];
const inBundle = (p: string): p is BundleKey => (BUNDLE as readonly string[]).includes(p);
const CHANGES: [
    RegExp,
    string[] | "all"
][] = [
    [/^\/api\/expr\/(ecrit\/draft|oral\/log|oral\/segment|oral\/prepare|oral\/realtime|oral\/chunk)/, []],
    [/^\/api\/sync/, ["/progress?section=co", "/progress?section=ce", "/me/stats"]],
    [/^\/api\/attempts/, ["/attempts?section=co", "/attempts?section=ce", "/me/stats"]],
    [/^\/api\/expr\//, ["/expr/sessions", "/me/stats"]],
    [/^\/api\/mock/, ["/mock/list", "/me/stats", "/attempts?section=co", "/attempts?section=ce", "/expr/sessions"]],
    [/^\/api\/disputes/, ["/disputes"]],
    [/^\/api\/me(\/key)?$/, ["/me/stats"]],
    [/^\/api\/donate/, []],
];
type Entry = {
    at: number;
    data: unknown;
};
type Box = {
    u: string;
    e: Record<string, Entry>;
};
let owner = (() => { try {
    return (JSON.parse(localStorage.getItem(KEY) ?? "null") as Box | null)?.u ?? "";
}
catch {
    return "";
} })();
function read(): Box | null {
    try {
        const b = JSON.parse(localStorage.getItem(KEY) ?? "null") as Box | null;
        return b && b.u === owner && b.e ? b : null;
    }
    catch {
        return null;
    }
}
function write(b: Box) {
    try {
        localStorage.setItem(KEY, JSON.stringify(b));
    }
    catch {
        try {
            localStorage.removeItem(KEY);
        }
        catch { }
    }
}
export function setCacheOwner(id: string | null) {
    owner = id ?? "";
    try {
        const b = JSON.parse(localStorage.getItem(KEY) ?? "null") as Box | null;
        if (b && b.u !== owner)
            localStorage.removeItem(KEY);
    }
    catch { }
}
export const clearCache = () => { try {
    localStorage.removeItem(KEY);
}
catch { } };
function drop(prefixes: string[]) {
    const b = read();
    if (!b)
        return;
    let changed = false;
    for (const k of Object.keys(b.e))
        if (prefixes.some((p) => k === p || k.startsWith(p))) {
            delete b.e[k];
            changed = true;
        }
    if (changed)
        write(b);
}
export function peek<T>(path: string): T | null {
    return (read()?.e[path]?.data as T | undefined) ?? null;
}
export function keep(path: string, data: unknown) {
    if (!owner)
        return;
    const b = read() ?? { u: owner, e: {} };
    b.e[path] = { at: Date.now(), data };
    const keys = Object.keys(b.e);
    if (keys.length > 60)
        keys.sort((x, y) => b.e[x].at - b.e[y].at).slice(0, keys.length - 60).forEach((k) => delete b.e[k]);
    write(b);
}
export const isFresh = (path: string, maxAge = HOUR) => { const hit = read()?.e[path]; return !!hit && Date.now() - hit.at < maxAge; };
export const staleBundle = (): BundleKey[] => BUNDLE.filter((k) => !isFresh(k));
export function keepBundle(extra: Record<string, unknown> | undefined) {
    if (!extra)
        return;
    for (const [k, v] of Object.entries(extra))
        if (inBundle(k) && v != null)
            keep(k, v);
}
let bundleInFlight: Promise<void> | null = null;
function refreshBundle(): Promise<void> {
    if (bundleInFlight)
        return bundleInFlight;
    const want = staleBundle();
    bundleInFlight = (want.length ? api<{
        extra?: Record<string, unknown>;
    }>(`/me?with=${encodeURIComponent(want.join(","))}`).then((d) => keepBundle(d.extra)) : Promise.resolve())
        .finally(() => { bundleInFlight = null; });
    return bundleInFlight;
}
export async function cached<T>(path: string, maxAge = HOUR): Promise<T> {
    const hit = read()?.e[path];
    if (hit && Date.now() - hit.at < maxAge)
        return hit.data as T;
    if (inBundle(path) && owner) {
        await refreshBundle().catch(() => null);
        const again = read()?.e[path];
        if (again)
            return again.data as T;
    }
    const data = await api<T>(path);
    keep(path, data);
    return data;
}
export function watchRequests() {
    if (typeof window === "undefined" || (window as {
        __apiWatch?: boolean;
    }).__apiWatch)
        return;
    (window as {
        __apiWatch?: boolean;
    }).__apiWatch = true;
    const plain = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        let ours = false;
        try {
            const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
            const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
            ours = url.pathname.startsWith("/api/");
            if (ours && method !== "GET" && method !== "HEAD") {
                const rule = CHANGES.find(([re]) => re.test(url.pathname));
                if (!rule || rule[1] === "all")
                    clearCache();
                else
                    drop(rule[1]);
            }
        }
        catch { }
        const p = plain(input, init);
        if (ours)
            p.then((r) => { try {
                noteServerDate(r);
            }
            catch { } }, () => { });
        return p;
    };
}
