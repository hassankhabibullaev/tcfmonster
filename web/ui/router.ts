import { useSyncExternalStore, type MouseEvent } from "react";
const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));
export function go(to: string) {
    if (to === location.pathname + location.search)
        return;
    history.pushState(null, "", to);
    listeners.forEach((l) => l());
    window.scrollTo(0, 0);
}
export function useLocation() {
    const href = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => location.pathname + location.search);
    const url = new URL(href, location.origin);
    return { path: url.pathname.replace(/\/+$/, "") || "/", params: url.searchParams };
}
export function setParams(next: Record<string, string | null>) {
    const url = new URL(location.href);
    for (const [k, v] of Object.entries(next))
        if (v === null || v === "")
            url.searchParams.delete(k);
        else
            url.searchParams.set(k, v);
    history.replaceState(null, "", url.pathname + url.search);
    listeners.forEach((l) => l());
}
export const linkProps = (to: string) => ({
    href: to,
    onClick: (e: MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
        return; e.preventDefault(); go(to); },
});
export function replace(to: string) {
    history.replaceState(null, "", to);
    listeners.forEach((l) => l());
}
