import type { Skill, TaskNo } from "./config.ts";
export const MAX_REVISIONS = 6;
export type SourceDocument = {
    author: string;
    stance?: "pour" | "contre";
    text: string;
};
export type Roleplay = {
    situation: string;
    examinerRole: string;
    register: "tu" | "vous";
    kind: string;
};
export type ExaminerPlan = {
    questions?: string[];
    followUps?: string[];
};
export type GeneratedPrompt = {
    id: string;
    skill: Skill;
    task: TaskNo;
    theme: string;
    topic: string;
    title?: string;
    consigne: string;
    wordCountMin?: number;
    wordCountMax?: number;
    timeLimitSeconds: number;
    prepTimeSeconds?: number;
    sourceDocuments?: SourceDocument[];
    roleplay?: Roleplay;
    examinerPlan?: ExaminerPlan;
    generatedAt: string;
    specVersion: string;
    source: "bank";
};
export function publicPrompt(p: GeneratedPrompt): Omit<GeneratedPrompt, "examinerPlan" | "roleplay"> & {
    roleplay?: Pick<Roleplay, "situation" | "examinerRole">;
} {
    const { examinerPlan: _ep, roleplay, ...rest } = p;
    void _ep;
    return { ...rest, roleplay: roleplay ? { situation: roleplay.situation, examinerRole: roleplay.examinerRole } : undefined };
}
export type PublicPrompt = ReturnType<typeof publicPrompt>;
export type Turn = {
    role: "examiner" | "candidate";
    text: string;
    t: number;
    clipId?: string;
    durationS?: number;
    stitched?: boolean;
    latencyMs?: number;
};
export type TaskResultSummary = {
    taskNo: TaskNo;
    score20: number | null;
    level: string | null;
    nclc: number | null;
    taskPoints?: number | null;
    taskPointsMax?: number;
};
export type SessionSummary = {
    tasks: TaskResultSummary[];
    score20: number | null;
    level: string | null;
    nclc: number | null;
    points: number | null;
    pointsMax: number;
    partial: boolean;
};
