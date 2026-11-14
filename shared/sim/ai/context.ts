export type AiContext = {
    key: string;
    userId: string;
    lang: "fr" | "en";
};
let current: () => AiContext = () => { throw new Error("no AI context: the Gemini key is not known here"); };
export const setAiContext = (get: () => AiContext) => { current = get; };
export const aiCtx = (): AiContext => current();
