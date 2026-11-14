import { aiCtx } from "./context.ts";
export type Cooldowns = Record<string, number>;
const until = new Map<string, number>();
export function cooldowns(now = Date.now(), userId = aiCtx().userId): Cooldowns {
    const map: Cooldowns = {};
    for (const [k, t] of until) {
        if (!k.startsWith(`${userId}:`))
            continue;
        if (t > now)
            map[k.slice(userId.length + 1)] = t;
        else
            until.delete(k);
    }
    return map;
}
export function setCooldown(model: string, untilMs: number, reason: string, userId?: string): void {
    try {
        const id = userId ?? aiCtx().userId;
        until.set(`${id}:${model}`, untilMs);
        console.warn(`${model} set aside until ${new Date(untilMs).toISOString()} (${reason.slice(0, 120)})`);
    }
    catch {
    }
}
export function filterChain(models: string[], cool: Cooldowns, now = Date.now(), avoid: string[] = []): string[] {
    const kept = models.filter((m) => !(cool[m] && cool[m] > now) && !avoid.includes(m));
    if (kept.length)
        return kept;
    const notAvoided = models.filter((m) => !avoid.includes(m));
    return notAvoided.length ? notAvoided : models;
}
export function retryAfterMs(text: string): number | null {
    const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
    if (m)
        return Math.round(Number(m[1]) * 1000);
    const t = /retry in\s+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?/i.exec(text);
    if (t && (t[1] || t[2] || t[3]))
        return (Number(t[1] ?? 0) * 3600 + Number(t[2] ?? 0) * 60 + Number(t[3] ?? 0)) * 1000;
    return null;
}
export function cooldownFor(status: number, text: string, now = Date.now()): number | null {
    if (status === 429) {
        const daily = /per day|daily|PerDay/i.test(text);
        const wait = retryAfterMs(text);
        if (daily)
            return now + Math.min(26 * 3600000, wait ?? 6 * 3600000);
        return now + Math.min(5 * 60000, Math.max(30000, wait ?? 60000));
    }
    if (status === 503)
        return now + 90000;
    return null;
}
