export const EXAMS = { co: 42, ce: 44 } as const;
export type ExamSection = keyof typeof EXAMS;
export const NEW_DAYS = 30;
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function isFresh(added: string | null | undefined, day: string): boolean {
    if (!added)
        return false;
    const until = new Date(Date.parse(added + "T00:00:00Z") + NEW_DAYS * 86400000).toISOString().slice(0, 10);
    return day >= added && day < until;
}
