// Which release notes a person has not seen (pages/ReleaseNote.tsx): no imports, so the tests read it as it is.

/** a release older than this is only on tcf.monster/changes */
export const SHOW_DAYS = 45;

export type Dated = { id: string; also?: string[]; date: string; forNew: boolean };

/** the releases newer than the one this browser last closed (`seen`), dated today or before and less than SHOW_DAYS
 *  old; a release that is not news to new accounts (`forNew: false`) only for an account made before it. `list` is
 *  newest first, and so is the answer. */
export function dueReleases<R extends Dated>(seen: string | null, joined: string | null | undefined, today: string, list: R[]): R[] {
  const closed = seen ? list.findIndex((r) => r.id === seen || r.also?.includes(seen)) : -1;
  const since = closed < 0 ? list : list.slice(0, closed);
  const cut = new Date(Date.parse(today + "T12:00:00Z") - SHOW_DAYS * 86400000).toISOString().slice(0, 10);
  return since.filter((r) => r.date <= today && r.date >= cut && (r.forNew || !joined || joined.slice(0, 10) < r.date));
}
