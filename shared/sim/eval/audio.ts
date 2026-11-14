import { chatAudio } from "../ai/gemini.ts";
import { SPEAKING, type TaskNo } from "../config.ts";
import { buildEvaluation, type Evaluation } from "./evaluate.ts";
import { AUDIO_SYSTEM, audioUserText, boundFluency, checkedJudgement, energyMetrics, explainChange, locateAt, parseAudioJudgement, wavSamples, type AudioJudgement, type Bound, type FluencyMetrics } from "./audio-core.ts";
import { languageRule, type FeedbackLang } from "./language.ts";
export type Heard = {
    judgement: AudioJudgement;
    metrics: FluencyMetrics | null;
};
const MARK = { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"] };
const HEARD_SCHEMA = {
    type: "object",
    properties: {
        aisance: MARK,
        prononciation: MARK,
        issues: { type: "array", items: { type: "string" } },
        sound: { type: "object", properties: { word: { type: "string" }, heard: { type: "string" }, tip: { type: "string" }, at: { type: "string" } } },
    },
    required: ["aisance", "prononciation"],
};
export type HeardClip = {
    data: ArrayBuffer;
    mime: string;
    durationS: number;
};
export const boundsOfClips = (clips: {
    durationS: number;
}[]): Bound[] => {
    let at = 0;
    return clips.map((c) => { const b = { start: at, end: at + Math.max(0, c.durationS) }; at = b.end; return b; });
};
export async function hearRecording(opts: {
    taskNo: TaskNo;
    transcript: string;
    lang: FeedbackLang;
    wav?: ArrayBuffer | null;
    bounds?: Bound[];
    clips?: HeardClip[];
}): Promise<Heard> {
    let metrics: FluencyMetrics | null = null;
    let audios: {
        data: ArrayBuffer;
        mime: string;
    }[];
    if (opts.wav) {
        try {
            const { pcm, rate } = wavSamples(opts.wav);
            metrics = energyMetrics(pcm, rate, opts.bounds ?? [], opts.transcript);
        }
        catch (e) {
            console.error("energy metrics failed", e);
        }
        audios = [{ data: opts.wav, mime: "audio/wav" }];
    }
    else {
        audios = (opts.clips ?? []).map((c) => ({ data: c.data, mime: c.mime }));
        if (!audios.length)
            throw new Error("rien à écouter");
    }
    const ask = () => chatAudio({ feature: "sim_oral_audio", system: AUDIO_SYSTEM, text: audioUserText({ taskNo: opts.taskNo, taskName: SPEAKING.tasks[opts.taskNo].name, transcript: opts.transcript, metrics, languageRule: languageRule(opts.lang) }), audios, jsonSchema: HEARD_SCHEMA });
    let heard = await ask();
    let parsed = parseAudioJudgement(heard.text);
    if (!parsed) {
        console.warn("listening answer unreadable, asked again:", heard.text.slice(0, 300));
        heard = await ask();
        parsed = parseAudioJudgement(heard.text);
    }
    if (!parsed) {
        console.warn("listening answer unreadable twice:", heard.text.slice(0, 300));
        throw new Error("L'analyse de l'enregistrement n'a pas abouti.");
    }
    const judgement = checkedJudgement(parsed);
    judgement.aisance.score = boundFluency(judgement.aisance.score, metrics);
    return { judgement, metrics };
}
export function completeWithAudio(ev: Evaluation, heard: Heard, bounds: Bound[], lang: FeedbackLang): Evaluation {
    const { judgement, metrics } = heard;
    const before = ev.transcriptScore20 ?? ev.score20;
    const given = [
        ...ev.criteria.filter((c) => c.source === "transcript").map((c) => ({ name: c.name, score: c.cappedFrom ?? c.score, reason: c.reason })),
        { name: "Fluency", score: judgement.aisance.score, reason: judgement.aisance.reason },
        { name: "Pronunciation", score: judgement.prononciation.score, reason: judgement.prononciation.reason },
    ];
    const sound = judgement.sound ? { word: judgement.sound.word, heard: judgement.sound.heard, tip: judgement.sound.tip, ...(judgement.sound.at != null ? locateAt(bounds, judgement.sound.at) ?? {} : {}) } : null;
    const full = buildEvaluation({ taskId: ev.taskId, skill: "speaking", task: ev.task, fulfilment: ev.fulfilment, facts: ev.facts, empty: false }, given, { holistic: ev.holistic, evidence: ev.evidence, fixes: ev.fixes, next: ev.next, sound });
    return { ...full, transcriptScore20: before, audio: { judgement, metrics, explanation: explainChange(before, full.score20, judgement, lang) } };
}
