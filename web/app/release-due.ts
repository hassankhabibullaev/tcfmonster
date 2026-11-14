export const SHOW_DAYS = 45;
export type Dated = {
    id: string;
    also?: string[];
    date: string;
    forNew: boolean;
};
export function dueReleases<R extends Dated>(seen: string | null, joined: string | null | undefined, today: string, list: R[]): R[] {
    const closed = seen ? list.findIndex((r) => r.id === seen || r.also?.includes(seen)) : -1;
    const since = closed < 0 ? list : list.slice(0, closed);
    const cut = new Date(Date.parse(today + "T12:00:00Z") - SHOW_DAYS * 86400000).toISOString().slice(0, 10);
    return since.filter((r) => r.date <= today && r.date >= cut && (r.forNew || !joined || joined.slice(0, 10) < r.date));
}
