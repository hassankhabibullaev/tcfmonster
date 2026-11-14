export type Me = {
    id: string;
    email: string;
    name: string | null;
    created_at: string;
    target_nclc: number | null;
    exam_date: string | null;
    lang: "fr" | "en";
    settings: Record<string, any>;
    gemini_status: string;
    isOwner: boolean;
    unread?: number;
    terms_ok?: boolean;
};
export class ApiError extends Error {
    status: number;
    data: any;
    constructor(status: number, data: any) { super(data?.error ?? `HTTP ${status}`); this.status = status; this.data = data; }
}
export const unauthorized = () => { try {
    window.dispatchEvent(new Event("tcfm:unauthorized"));
}
catch { } };
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
    let r: Response;
    try {
        r = await fetch(`/api${path}`, body === undefined ? { credentials: "same-origin" } : { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    }
    catch {
        throw new ApiError(0, { error: "network" });
    }
    const data: any = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.startsWith("/auth/") && data?.error !== "refused")
        unauthorized();
    if (!r.ok)
        throw new ApiError(r.status, data);
    return data as T;
}
export async function stretch(email: string, password: string) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(`tcf.monster|${email.trim().toLowerCase()}`), iterations: 210000 }, key, 256);
    return btoa(String.fromCharCode(...new Uint8Array(bits))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export function strength(pw: string) {
    if (pw.length < 8)
        return 0;
    const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
    const common = /^(password|motdepasse|azerty|qwerty|12345678|123456789|00000000|11111111)/i.test(pw);
    if (common)
        return 1;
    if (pw.length >= 14 || (pw.length >= 10 && kinds >= 3))
        return 3;
    if (pw.length >= 10 || kinds >= 3)
        return 2;
    return 1;
}
export function daysTo(examDate: string | null) {
    if (!examDate)
        return null;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return Math.round((new Date(examDate + "T12:00:00").getTime() - today.getTime()) / 86400000);
}
