// How many exams each section has (public/data/exam-<section>-01 … NN.json), read by the Worker and the pages alike.
// scripts/bank-export.py writes the same numbers into bank.json and fails when they differ from its own.
// Listening 41–42 and reading 41–44 came on 2026-11-11 (BANK.md).
export const EXAMS = { co: 42, ce: 44 } as const;
export type ExamSection = keyof typeof EXAMS;
/** a question or an exam added to the bank wears « Nouveau » this many days */
export const NEW_DAYS = 30;
/** the device's own day, YYYY-MM-DD */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** « Nouveau » still shows on `day` (YYYY-MM-DD, the person's own day) for something added on `added` */
export function isFresh(added: string | null | undefined, day: string): boolean {
  if (!added) return false;
  const until = new Date(Date.parse(added + "T00:00:00Z") + NEW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return day >= added && day < until;
}
