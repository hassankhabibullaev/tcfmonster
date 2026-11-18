import type { MicMode, Turn } from "./types";
import { AiError, liveToken } from "../../../shared/sim/ai/gemini.ts";
import { askedHere, keyTrouble, liveKey } from "./browser-score";
import { getWork, workOfSession } from "./work";
async function liveNotes(sessionId: string, taskNo: number, reconnect: boolean): Promise<string[]> {
    const { continuityNote, resumeNote } = await import("../../../shared/sim/live-notes.ts");
    const all = await workOfSession(sessionId);
    const earlier = continuityNote(all.map((w) => ({ taskNo: w.taskNo, turns: (w.turns ?? []) as Turn[] })), taskNo);
    const here = reconnect ? resumeNote([...(((await getWork(sessionId, taskNo))?.turns ?? []) as Turn[])]) : "";
    return [earlier, here].filter(Boolean);
}
export type LiveHandlers = {
    onSpeechStarted?: () => void;
    onSpeechStopped?: () => void;
    onAudioStart?: () => void;
    onAudioStop?: () => void;
    onExaminerText?: (text: string) => void;
    onCandidateText?: (text: string) => void;
    onClosed?: (reason: string, info: {
        self: LiveExaminer;
        model: string;
        resumeHandle: string | null;
    }) => void;
};
export type ConnectOptions = {
    mode: MicMode;
    taskNo: 1 | 2 | 3;
    lastModel?: string | null;
    resumeHandle?: string | null;
    avoid?: string[];
};
const IN_RATE = 16000;
const OUT_RATE = 24000;
const THRESHOLD = 0.012;
const SILENCE_MS = 800;
export const WORKLET_URL = "/worklets/capture.js";
function b64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
}
function unb64(s: string): ArrayBuffer {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out.buffer;
}
type ServerContent = {
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
    inputTranscription?: {
        text?: string;
    };
    outputTranscription?: {
        text?: string;
    };
    modelTurn?: {
        parts?: {
            inlineData?: {
                data: string;
                mimeType: string;
            };
            text?: string;
        }[];
    };
};
export const CONNECT_DEADLINE_MS = 25000;
export const SILENT_LINE_MS = 10000;
const open = new Set<LiveExaminer>();
export class BusyError extends Error {
    retryInS: number;
    constructor(message: string, retryInS: number) {
        super(message);
        this.retryInS = retryInS;
    }
}
export class LiveExaminer {
    stream: MediaStream | null = null;
    model = "";
    resumed = false;
    resumeHandle: string | null = null;
    private ws: WebSocket | null = null;
    private mic: MediaStream | null = null;
    private inCtx: AudioContext | null = null;
    private outCtx: AudioContext | null = null;
    private dest: MediaStreamAudioDestinationNode | null = null;
    private playing: AudioBufferSourceNode[] = [];
    private nextAt = 0;
    private closed = false;
    private micOn = false;
    private mode: MicMode;
    private silenceMs = SILENCE_MS;
    private pressed = false;
    private streaming = false;
    private loudSince = 0;
    private quietSince = 0;
    private preRoll: ArrayBuffer[] = [];
    private examinerOn = false;
    private turnOpen = false;
    private muteNext = false;
    private said = "";
    private heard = "";
    private sayWaiters = new Set<() => void>();
    private lastPrompt = 0;
    private lastSay = 0;
    private lastHeardAt = -Infinity;
    private lastAudioAt = -Infinity;
    private hushed = false;
    private h: LiveHandlers;
    private constructor(h: LiveHandlers, mode: MicMode) {
        this.h = h;
        this.mode = mode;
        open.add(this);
    }
    static connect(sessionId: string, handlers: LiveHandlers, opts: ConnectOptions, timeoutMs = 12000, deadlineMs = CONNECT_DEADLINE_MS): Promise<LiveExaminer> {
        return new Promise((resolve, reject) => {
            let late = false;
            const timer = setTimeout(() => {
                late = true;
                reject(new Error("connexion trop lente"));
            }, deadlineMs);
            LiveExaminer.opening(sessionId, handlers, opts, timeoutMs).then((ex) => {
                clearTimeout(timer);
                if (late)
                    ex.close();
                else
                    resolve(ex);
            }, (e) => {
                clearTimeout(timer);
                if (!late)
                    reject(e);
            });
        });
    }
    static closeAll() {
        for (const ex of [...open])
            ex.close();
    }
    static wake() {
        for (const ex of open) {
            if (ex.closed)
                continue;
            for (const ctx of [ex.inCtx, ex.outCtx])
                if (ctx?.state === "suspended")
                    void ctx.resume().catch(() => { });
        }
    }
    private static async opening(sessionId: string, handlers: LiveHandlers, opts: ConnectOptions, timeoutMs: number): Promise<LiveExaminer> {
        const r = await fetch("/api/expr/oral/realtime", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, taskNo: opts.taskNo, asked: askedHere() }) });
        const script = (await r.json().catch(() => ({}))) as {
            instructions?: string;
            sessionSeconds?: number;
            error?: string;
        };
        if (!r.ok || !script.instructions)
            throw new Error(script.error ?? "session en direct indisponible");
        const notes = await liveNotes(sessionId, opts.taskNo, !!(opts.lastModel || opts.resumeHandle));
        let d: {
            token: string;
            apiVersion: string;
            model: string;
            resumed: boolean;
        };
        try {
            await liveKey();
            d = await liveToken({ instructions: [script.instructions, ...notes].join("\n\n"), sessionSeconds: script.sessionSeconds ?? 600, lastModel: opts.lastModel, resumeHandle: opts.resumeHandle, avoid: opts.avoid ?? [] }).catch(keyTrouble);
        }
        catch (e) {
            if (e instanceof AiError && (e.code === "busy" || e.status === 503))
                throw new BusyError(e.message || "examinatrice occupée", e.retryInS ?? 120);
            throw e;
        }
        const self = new LiveExaminer(handlers, opts.mode);
        self.model = d.model;
        self.resumed = !!d.resumed;
        if (self.resumed)
            self.resumeHandle = opts.resumeHandle ?? null;
        const gone = () => {
            if (!self.closed)
                return;
            self.release();
            throw new Error("fermée pendant l'ouverture");
        };
        try {
            self.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
            gone();
            self.inCtx = new AudioContext({ sampleRate: IN_RATE });
            self.outCtx = new AudioContext({ sampleRate: OUT_RATE });
            self.dest = self.outCtx.createMediaStreamDestination();
            self.stream = self.dest.stream;
            await self.inCtx.audioWorklet.addModule(WORKLET_URL);
            gone();
            await self.open(d.token, d.apiVersion ?? "v1alpha", d.model, timeoutMs);
            gone();
            const src = self.inCtx.createMediaStreamSource(self.mic);
            const node = new AudioWorkletNode(self.inCtx, "capture");
            node.port.onmessage = (ev: MessageEvent<{
                pcm: ArrayBuffer;
                rms: number;
            }>) => self.onChunk(ev.data.pcm, ev.data.rms);
            src.connect(node);
            const mute = self.inCtx.createGain();
            mute.gain.value = 0;
            node.connect(mute).connect(self.inCtx.destination);
            return self;
        }
        catch (e) {
            if (self.closed)
                self.release();
            else
                self.close();
            throw e;
        }
    }
    private open(token: string, apiVersion: string, model: string, timeoutMs: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${apiVersion}.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(url);
            ws.binaryType = "arraybuffer";
            this.ws = ws;
            let ready = false;
            const timer = setTimeout(() => {
                if (!ready)
                    reject(new Error("connexion trop lente"));
            }, timeoutMs);
            ws.onopen = () => {
                ws.send(JSON.stringify({ setup: { model: `models/${model}` } }));
            };
            ws.onmessage = (ev) => {
                const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
                let msg: Record<string, unknown>;
                try {
                    msg = JSON.parse(text);
                }
                catch {
                    return;
                }
                if (!ready && "setupComplete" in msg) {
                    ready = true;
                    clearTimeout(timer);
                    resolve();
                    return;
                }
                this.onMessage(msg);
            };
            ws.onerror = () => {
                if (!ready)
                    reject(new Error("la connexion avec Google n'a pas pu s'ouvrir"));
            };
            ws.onclose = (ev) => {
                const reason = ev.reason || (ev.code === 1000 ? "fermée" : `code ${ev.code}`);
                if (!ready)
                    reject(new Error(`Google a fermé la connexion : ${reason}`));
                else
                    this.fail(reason);
            };
        });
    }
    private send(obj: unknown) {
        if (this.ws?.readyState === WebSocket.OPEN)
            this.ws.send(JSON.stringify(obj));
    }
    setMic(on: boolean) {
        this.micOn = on;
        if (!on) {
            this.pressed = false;
            this.endTurnIfOpen();
        }
    }
    setMode(mode: MicMode) {
        this.mode = mode;
    }
    setSilence(ms: number) {
        this.silenceMs = ms;
    }
    pressStart() {
        if (!this.micOn || this.closed)
            return;
        this.pressed = true;
        this.preRoll = [];
    }
    get isPressed() {
        return this.pressed;
    }
    resetPress() {
        this.pressed = false;
        this.preRoll = [];
    }
    pressEnd() {
        this.pressed = false;
        this.endTurnIfOpen();
    }
    endTurn() {
        this.pressed = false;
        this.endTurnIfOpen();
    }
    muteNextTurn() {
        this.muteNext = true;
    }
    get speaking() {
        return this.streaming;
    }
    get talking() {
        return this.examinerOn;
    }
    get isClosed() {
        return this.closed;
    }
    unanswered(ms: number) {
        return this.lastPrompt > 0 && this.lastHeardAt < this.lastPrompt && performance.now() - this.lastPrompt >= ms;
    }
    drop(reason: string) {
        this.fail(reason);
    }
    get heardSoFar() {
        return this.heard.trim();
    }
    prompt(text: string, timeoutMs = 15000): Promise<boolean> {
        return this.ask(`Consigne de régie : ${text}`, timeoutMs, false);
    }
    private ask(text: string, timeoutMs: number, isLine: boolean): Promise<boolean> {
        if (this.closed || this.ws?.readyState !== WebSocket.OPEN)
            return Promise.resolve(false);
        this.claim();
        return new Promise<boolean>((resolve) => {
            const at = performance.now();
            const done = () => {
                clearTimeout(timer);
                clearTimeout(silent);
                this.sayWaiters.delete(done);
                resolve(this.lastAudioAt >= at);
            };
            const timer = setTimeout(done, timeoutMs);
            const silent = setTimeout(() => { if (this.lastHeardAt < at)
                done(); }, Math.min(SILENT_LINE_MS, timeoutMs));
            this.sayWaiters.add(done);
            this.lastPrompt = at;
            if (isLine)
                this.lastSay = at;
            this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
        });
    }
    private claim() {
        this.hushed = false;
        for (const o of open)
            if (o !== this && !o.hushed)
                o.hush();
    }
    private hush() {
        this.hushed = true;
        this.stopPlayback();
    }
    get isHushed() {
        return this.hushed;
    }
    private endTurnIfOpen() {
        if (!this.streaming)
            return;
        this.streaming = false;
        this.loudSince = 0;
        this.quietSince = 0;
        this.send({ realtimeInput: { activityEnd: {} } });
        this.lastPrompt = performance.now();
        this.h.onSpeechStopped?.();
    }
    private startTurn() {
        this.streaming = true;
        this.quietSince = 0;
        this.send({ realtimeInput: { activityStart: {} } });
        for (const p of this.preRoll)
            this.sendAudio(p);
        this.preRoll = [];
        this.h.onSpeechStarted?.();
    }
    private onChunk(pcm: ArrayBuffer, rms: number) {
        if (this.closed)
            return;
        const gate = this.mode === "ptt" ? this.pressed : this.micOn;
        if (!gate) {
            if (this.streaming)
                this.endTurnIfOpen();
            return;
        }
        const now = performance.now();
        const loud = rms > (this.examinerOn ? THRESHOLD * 2.5 : THRESHOLD);
        const attackMs = this.examinerOn ? 250 : 60;
        if (!this.streaming) {
            this.preRoll.push(pcm);
            if (this.preRoll.length > 15)
                this.preRoll.shift();
            if (this.mode === "ptt") {
                this.startTurn();
                return;
            }
            if (loud) {
                if (!this.loudSince)
                    this.loudSince = now;
                if (now - this.loudSince >= attackMs)
                    this.startTurn();
            }
            else
                this.loudSince = 0;
            return;
        }
        this.sendAudio(pcm);
        if (this.mode === "ptt")
            return;
        if (loud)
            this.quietSince = 0;
        else {
            if (!this.quietSince)
                this.quietSince = now;
            if (now - this.quietSince >= this.silenceMs)
                this.endTurnIfOpen();
        }
    }
    private sendAudio(pcm: ArrayBuffer) {
        this.send({ realtimeInput: { audio: { data: b64(pcm), mimeType: `audio/pcm;rate=${IN_RATE}` } } });
    }
    say(text: string, timeoutMs?: number): Promise<boolean> {
        timeoutMs ??= Math.max(15000, 6000 + text.length * 110);
        return this.ask(`Consigne de régie : dis exactement ce texte, en français, d'une seule traite, sans pause entre les phrases, sans rien ajouter ni changer, sur le ton neutre de l'examinatrice : « ${text} »`, timeoutMs, true);
    }
    sayNow(text: string, endTurn: boolean, timeoutMs?: number): Promise<boolean> {
        if (endTurn) {
            this.pressed = false;
            this.micOn = false;
            this.endTurnIfOpen();
        }
        this.muteNext = false;
        return this.say(text, timeoutMs);
    }
    private lineOver() {
        for (const w of [...this.sayWaiters])
            w();
    }
    private onMessage(msg: Record<string, unknown>) {
        this.lastHeardAt = performance.now();
        const sr = msg.sessionResumptionUpdate as {
            newHandle?: string;
            resumable?: boolean;
        } | undefined;
        if (sr?.resumable && sr.newHandle)
            this.resumeHandle = sr.newHandle;
        const ga = msg.goAway as {
            timeLeft?: string;
        } | undefined;
        if (ga)
            console.warn(`live examiner: Google will close the connection in ${ga.timeLeft ?? "?"}`);
        const sc = msg.serverContent as ServerContent | undefined;
        if (!sc)
            return;
        if (sc.interrupted) {
            this.turnOpen = false;
            this.stopPlayback();
            if (this.said.trim() && !this.muteNext)
                this.h.onExaminerText?.(`${this.said.trim()}…`);
            this.said = "";
            this.muteNext = false;
            if (performance.now() - this.lastSay > 3000)
                this.lineOver();
            return;
        }
        if (sc.inputTranscription?.text)
            this.heard += sc.inputTranscription.text;
        if (sc.outputTranscription?.text)
            this.said += sc.outputTranscription.text;
        for (const part of sc.modelTurn?.parts ?? []) {
            if (!part.inlineData?.data)
                continue;
            this.turnOpen = true;
            if (this.muteNext)
                continue;
            this.lastAudioAt = performance.now();
            if (!this.hushed)
                this.play(unb64(part.inlineData.data));
        }
        if (sc.turnComplete) {
            this.turnOpen = false;
            if (this.heard.trim())
                this.h.onCandidateText?.(this.heard.trim());
            this.heard = "";
            const text = this.said.trim();
            this.said = "";
            if (this.muteNext) {
                this.muteNext = false;
                this.lineOver();
                this.h.onAudioStop?.();
                return;
            }
            if (text)
                this.h.onExaminerText?.(text);
            if (this.playing.length === 0)
                this.endOfVoice();
        }
    }
    private play(pcm: ArrayBuffer) {
        const ctx = this.outCtx;
        if (!ctx || this.closed)
            return;
        if (ctx.state === "suspended")
            void ctx.resume().catch(() => { });
        const i16 = new Int16Array(pcm);
        const buf = ctx.createBuffer(1, i16.length, OUT_RATE);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < i16.length; i++)
            ch[i] = i16[i] / 0x8000;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        if (this.dest)
            src.connect(this.dest);
        const at = Math.max(ctx.currentTime + 0.02, this.nextAt);
        src.start(at);
        this.nextAt = at + buf.duration;
        this.playing.push(src);
        if (!this.examinerOn) {
            this.examinerOn = true;
            this.h.onAudioStart?.();
        }
        src.onended = () => {
            this.playing = this.playing.filter((s) => s !== src);
            if (this.playing.length === 0 && !this.turnOpen)
                this.endOfVoice();
        };
    }
    private endOfVoice() {
        if (!this.examinerOn) {
            this.lineOver();
            return;
        }
        this.examinerOn = false;
        this.lineOver();
        this.h.onAudioStop?.();
    }
    private stopPlayback() {
        for (const s of this.playing) {
            try {
                s.onended = null;
                s.stop();
            }
            catch { }
        }
        this.playing = [];
        this.nextAt = 0;
        if (this.examinerOn) {
            this.examinerOn = false;
            this.h.onAudioStop?.();
        }
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        open.delete(this);
        this.lineOver();
        this.stopPlayback();
        this.release();
    }
    private release() {
        try {
            if (this.ws && this.ws.readyState !== WebSocket.CLOSED)
                this.ws.close(1000, "done");
        }
        catch { }
        this.mic?.getTracks().forEach((t) => t.stop());
        for (const ctx of [this.inCtx, this.outCtx])
            if (ctx && ctx.state !== "closed")
                void ctx.close().catch(() => { });
    }
    private fail(reason: string) {
        if (this.closed)
            return;
        this.close();
        this.h.onClosed?.(reason, { self: this, model: this.model, resumeHandle: this.resumeHandle });
    }
}
