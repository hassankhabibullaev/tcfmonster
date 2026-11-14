import { SPEAKING, type TaskNo } from "./config.ts";
export type Timing = {
    prepS: number;
    speakS: number;
    silenceS: number;
    introSilenceS?: number;
    resumeS: number;
    minSpeechS: number;
    firstInterjectS: number | null;
    minDevelopS: number;
    idleRelanceS: number;
    tailS: number;
    graceS: number;
    minAskS: number;
    introMaxS: number | null;
    minFollowUps: number;
    overrunS: number;
    stallS: number | null;
    stallAskS: number;
    idleAtZeroS: number;
};
const base = { tailS: 2, resumeS: 3.5, introMaxS: null, minFollowUps: 0, stallS: null, stallAskS: 0, idleAtZeroS: 4 };
export const TIMING: Record<TaskNo, Timing> = {
    1: { ...base, prepS: SPEAKING.tasks[1].prepSeconds, speakS: SPEAKING.tasks[1].speakSeconds, silenceS: 2.4, introSilenceS: 3.2, minSpeechS: 2, firstInterjectS: null, minDevelopS: 0, idleRelanceS: 7, graceS: 5, minAskS: 10, introMaxS: 90, minFollowUps: 2, overrunS: 30 },
    2: { ...base, prepS: SPEAKING.tasks[2].prepSeconds, speakS: SPEAKING.tasks[2].speakSeconds, silenceS: 1.0, minSpeechS: 1.2, firstInterjectS: null, minDevelopS: 0, idleRelanceS: 6, graceS: 5, minAskS: 10, overrunS: 30 },
    3: { ...base, prepS: SPEAKING.tasks[3].prepSeconds, speakS: SPEAKING.tasks[3].speakSeconds, silenceS: 3.2, minSpeechS: 4, firstInterjectS: null, minDevelopS: 0, idleRelanceS: 8, graceS: 0, minAskS: 30, stallS: null, stallAskS: 0, overrunS: 15 },
};
export type Clock = {
    elapsed: number;
    introDone: boolean;
    asked: number;
    questionEndAt: number;
    turnStartAt: number;
};
export function followUpsOwed(t: Timing, c: Clock): boolean {
    return t.minFollowUps > 0 && c.introDone && c.asked < t.minFollowUps && c.elapsed < t.speakS + t.overrunS;
}
export function canAsk(t: Timing, c: Clock): boolean {
    return followUpsOwed(t, c) || t.speakS - c.elapsed >= t.minAskS;
}
export function questionDeservesAnswer(t: Timing, c: Clock): boolean {
    return c.turnStartAt > 0 && t.speakS - c.turnStartAt >= t.minAskS;
}
export function cutAt(t: Timing, c: Clock): number {
    return Math.min(t.speakS + t.overrunS, Math.max(t.speakS, c.questionEndAt) + t.graceS);
}
export function timeIsUp(t: Timing, c: Clock & {
    midAnswer: boolean;
    idle?: boolean;
}): boolean {
    if (c.elapsed >= t.speakS + t.overrunS)
        return true;
    if (c.elapsed < t.speakS)
        return false;
    if (c.midAnswer)
        return c.elapsed >= cutAt(t, c);
    if (c.idle)
        return c.elapsed >= Math.max(t.speakS, c.questionEndAt) + t.idleAtZeroS;
    return !followUpsOwed(t, c);
}
export function introCut(t: Timing, segS: number, silenceS: number): boolean {
    if (t.introMaxS == null)
        return false;
    return segS >= t.introMaxS || (segS >= t.introMaxS - 6 && silenceS >= 0.5);
}
export const WARN_S = 20;
export const BLINK_S = 10;
