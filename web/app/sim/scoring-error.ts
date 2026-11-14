export type ApiFailure = {
    error?: string;
    code?: string;
    retryInS?: number;
};
export type Failure = {
    message: string;
    retryInS: number;
    google: boolean;
    key?: boolean;
    away?: boolean;
};
const MIN = (s: number) => Math.max(1, Math.round(s / 60));
export function explainFailure(e: unknown, lang: "fr" | "en" = "fr"): Failure {
    const d = (e && typeof e === "object" ? e : {}) as ApiFailure & {
        name?: string;
        message?: string;
    };
    const code = d.code ?? "";
    const retryInS = Math.min(600, Math.max(60, Number(d.retryInS) || 180));
    if (code === "unauthorized") {
        return {
            google: false, key: true, retryInS: 600,
            message: lang === "fr"
                ? "Google refuse votre clé Gemini. Votre travail est enregistré : remplacez la clé dans le profil, puis réessayez."
                : "Google refuses your Gemini key. Your work is saved: replace the key in your profile, then retry.",
        };
    }
    const google = code === "overloaded" || code === "rate_limited" || code === "model_missing";
    if (google) {
        const m = MIN(retryInS);
        return {
            google: true,
            retryInS,
            message: lang === "fr"
                ? `Google (Gemini) est surchargé en ce moment. Votre travail est enregistré : la correction sera relancée dans ${m} minute${m > 1 ? "s" : ""}, ou tout de suite si vous le demandez.`
                : `Google (Gemini) is overloaded right now. Your work is saved: the marking will be tried again in ${m} minute${m > 1 ? "s" : ""}, or right away if you ask.`,
        };
    }
    const timeout = d.name === "TimeoutError" || d.name === "AbortError" || /Failed to fetch|NetworkError|Load failed/i.test(d.message ?? "");
    if (timeout) {
        return {
            google: false,
            retryInS: 120,
            message: lang === "fr" ? "Le serveur n'a pas répondu à temps. Votre travail est enregistré : la correction sera relancée dans 2 minutes." : "The server did not answer in time. Your work is saved: the marking will be tried again in 2 minutes.",
        };
    }
    const detail = (d.error ?? d.message ?? "").slice(0, 200);
    return {
        google: false,
        retryInS,
        message: lang === "fr" ? `La correction n'a pas abouti${detail ? ` (${detail})` : ""}. Votre travail est enregistré : réessayez dans un instant.` : `The marking did not come through${detail ? ` (${detail})` : ""}. Your work is saved: try again in a moment.`,
    };
}
export async function failureOf(r: Response | null, e?: unknown, lang: "fr" | "en" = "fr"): Promise<Failure> {
    if (r) {
        const body = (await r.json().catch(() => ({}))) as ApiFailure;
        return explainFailure({ ...body, code: body.code ?? (r.status === 503 ? "overloaded" : r.status === 429 ? "rate_limited" : "") }, lang);
    }
    return explainFailure(e, lang);
}
export const SCORING_TIMEOUT_MS = 150000;
export const LISTENING_TIMEOUT_MS = 200000;
