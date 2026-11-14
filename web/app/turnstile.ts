type TS = {
    render: (el: HTMLElement, o: Record<string, unknown>) => string;
    remove: (id: string) => void;
};
declare global {
    interface Window {
        turnstile?: TS;
    }
}
let loading: Promise<TS> | null = null;
function load(): Promise<TS> {
    if (window.turnstile)
        return Promise.resolve(window.turnstile);
    loading ??= new Promise<TS>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        s.async = true;
        s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
        s.onerror = () => { loading = null; reject(new Error("turnstile")); };
        document.head.appendChild(s);
    });
    return loading;
}
export async function humanToken(sitekey: string, action: string, lang: string, slot?: HTMLElement | null, appearance: "always" | "interaction-only" = "interaction-only"): Promise<string> {
    const ts = await load();
    const box = document.createElement("div");
    box.className = slot ? "ts-in" : "ts-box";
    (slot ?? document.body).appendChild(box);
    return new Promise<string>((resolve, reject) => {
        let id = "";
        const timer = setTimeout(() => { done(); reject(new Error("turnstile")); }, 120000);
        const done = () => { clearTimeout(timer); setTimeout(() => { try {
            ts.remove(id);
        }
        catch { } box.remove(); }, 0); };
        id = ts.render(box, {
            sitekey, action, language: lang, appearance,
            callback: (t: string) => { done(); resolve(t); },
            "error-callback": () => { done(); reject(new Error("turnstile")); },
            "expired-callback": () => { done(); reject(new Error("turnstile")); },
        });
    });
}
