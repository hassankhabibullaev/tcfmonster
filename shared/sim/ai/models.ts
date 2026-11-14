export const MODELS = {
    cheap: "gemini-3.5-flash-lite",
    mid: "gemini-3.8-flash",
    midFallbacks: ["gemini-3.7-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
    cheapFallbacks: ["gemini-3.1-flash-lite", "gemini-3.5-flash"],
    stt: "gemini-3.5-flash-lite",
    live: "gemini-3.8-live",
    liveFallbacks: ["gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest"],
    audio: "gemini-3.8-flash",
} as const;
export type ModelTier = "cheap" | "mid";
export const TTS_VOICE = "Kore";
export type RealtimeUsage = {
    textIn: number;
    audioIn: number;
    cachedTextIn: number;
    cachedAudioIn: number;
    textOut: number;
    audioOut: number;
};
