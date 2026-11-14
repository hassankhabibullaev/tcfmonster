export type SectionStat = {
    n: number;
    best: number | null;
    worst: number | null;
    typical: number | null;
    current: number | null;
    last: string | null;
    trend: "up" | "down" | "flat" | null;
    series: number[];
};
export type Recent = {
    section: "co" | "ce" | "ee" | "eo";
    kind: "exam" | "practice";
    at: string;
    score: number | null;
    nclc: number | null;
    label: string;
    href: string;
};
export type Stats = {
    sections: Record<"co" | "ce" | "ee" | "eo", SectionStat>;
    facts: {
        sessions: number;
        minutes: number;
        days: number;
        streak: number;
        since: string | null;
    };
    recent: Recent[];
    activity: Record<string, number>;
    work: Record<string, number>;
    practice: Record<"co" | "ce", Record<string, {
        green: number;
        red: number;
        amber: number;
    }>>;
    exams: Record<"co" | "ce", {
        taken: number;
        distinct: number;
        best: number | null;
        last: number | null;
    }>;
    tasks: Record<"ee" | "eo", {
        sessions: number;
        avg20: number | null;
        byTask: Record<string, number | null>;
    }>;
    mocks: {
        count: number;
        best: number | null;
        last: {
            id: number;
            at: string;
            status: string;
            nclc: Record<"co" | "ce" | "ee" | "eo", number | null>;
            overall: number | null;
        } | null;
    };
};
