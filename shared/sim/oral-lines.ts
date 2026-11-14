export type SessionShape = {
    tasks: (1 | 2 | 3)[];
};
export type ScriptOpts = {
    exam?: boolean;
};
const DURATION: Record<1 | 2 | 3, string> = { 1: "deux minutes", 2: "trois minutes trente", 3: "quatre minutes trente" };
const NAME: Record<1 | 2 | 3, string> = { 1: "un entretien", 2: "un exercice en interaction", 3: "l'expression d'un point de vue" };
const ORDINAL: Record<1 | 2 | 3, string> = { 1: "première", 2: "deuxième", 3: "troisième" };
const taskLabel = (n: 1 | 2 | 3, shape: SessionShape) => (shape.tasks.length > 1 && shape.tasks[shape.tasks.length - 1] === n ? `la ${ORDINAL[n]} et dernière tâche` : `la ${ORDINAL[n]} tâche`);
export const EXAM_OPENING = "Bonjour. Bienvenue à l'épreuve d'expression orale du TCF Canada. Cette épreuve dure environ douze minutes. C'est un entretien en trois parties, sans préparation, sauf pour la deuxième tâche. L'entretien est enregistré. À tout moment, vous pouvez me faire répéter ou reformuler un mot ou une question. Attention, une fois l'enregistrement commencé, il ne pourra plus être arrêté. Nous commençons. Tout d'abord, dites-moi vos prénom et nom, s'il vous plaît.";
export const EXAM_RULES: Record<1 | 2 | 3, string> = {
    1: "Voici la première tâche. Cette partie de l'épreuve dure deux minutes. Est-ce que vous pouvez vous présenter ?",
    2: "Nous passons à la deuxième tâche. Elle dure trois minutes trente. Nous allons discuter comme dans la vie quotidienne. Je vais vous présenter la situation ; vous aurez ensuite deux minutes pour la préparer. Voici la situation.",
    3: "Pour finir, voici la troisième tâche. Elle dure quatre minutes trente. Vous allez me donner votre opinion. Voici le sujet.",
};
export function opening(shape: SessionShape, opts: ScriptOpts = {}): string {
    if (opts.exam)
        return EXAM_OPENING;
    const n = shape.tasks.length;
    const list = n === 3 ? "trois tâches" : n === 2 ? `deux tâches, la ${ORDINAL[shape.tasks[0]]} et la ${ORDINAL[shape.tasks[1]]}` : `une seule tâche, la ${ORDINAL[shape.tasks[0]]}`;
    return `Bonjour, bienvenue à l'épreuve d'expression orale. Aujourd'hui, elle comporte ${list}.`;
}
export function rules(n: 1 | 2 | 3, shape: SessionShape, first: boolean, opts: ScriptOpts = {}): string {
    if (opts.exam)
        return EXAM_RULES[n];
    const lead = first ? `Commençons par ${taskLabel(n, shape)} :` : `Passons à ${taskLabel(n, shape)} :`;
    if (n === 1)
        return `${lead} ${NAME[1]} de ${DURATION[1]}, sans préparation. Je vais vous poser quelques questions sur vous. Pour commencer, pouvez-vous vous présenter ?`;
    if (n === 2)
        return `${lead} ${NAME[2]}. Je vais vous présenter une situation. Vous aurez deux minutes pour préparer vos questions, puis nous jouerons la scène pendant ${DURATION[2]}. Voici la situation.`;
    return `${lead} ${NAME[3]}. Il n'y a pas de préparation ; vous avez ${DURATION[3]}. Voici le sujet.`;
}
export const FIXED = {
    prepStart: "Vous pouvez prendre des notes. Je vous laisse vous préparer.",
    prepOver: "La préparation est terminée. C'est à vous, je vous écoute.",
    go3: "Je vous écoute.",
    ack1: "Merci. Je vais maintenant vous poser quelques questions pour mieux vous connaître.",
    cut1: "Merci, je vous arrête là. Je vais maintenant vous poser quelques questions pour mieux vous connaître.",
    cut3: "Merci. J'ai une question pour vous.",
    relance1: "D'accord. Pouvez-vous m'en dire un peu plus ?",
    relance3: "Pouvez-vous développer ce point ?",
    open3: "Je vous écoute.",
};
export const CLOSE = {
    done: { 1: "Très bien, je vous remercie.", 2: "Merci. Nous allons nous arrêter là pour cette tâche.", 3: "Merci beaucoup." } as Record<1 | 2 | 3, string>,
    cut: {
        1: ["Merci, je dois vous arrêter là : le temps est écoulé.", "Je vous arrête ici, le temps est écoulé. Merci."],
        2: ["Excusez-moi, je vous arrête : le temps est écoulé.", "Pardon, je dois vous interrompre, le temps est écoulé."],
        3: ["Merci, je vous arrête là : le temps est écoulé.", "Je dois vous arrêter ici, le temps est écoulé. Merci."],
    } as Record<1 | 2 | 3, string[]>,
    lateQuestion2: "Je suis désolée, le temps est écoulé, je ne peux plus répondre à cette question. Nous allons nous arrêter là.",
};
export const FAREWELL = "L'épreuve est terminée. Vos résultats arrivent dans un instant. Je vous souhaite une bonne journée, au revoir.";
export const ALL_LINES: string[] = [...Object.values(FIXED), ...Object.values(CLOSE.done), ...Object.values(CLOSE.cut).flat(), CLOSE.lateQuestion2, FAREWELL, EXAM_OPENING, ...Object.values(EXAM_RULES)];
export const isScriptLine = (text: string) => ALL_LINES.includes(text) || /^(Bonjour, bienvenue à l'épreuve|Bonjour\. Bienvenue à l'épreuve|Commençons par la |Passons à la |Voici la première tâche\.|Nous passons à la deuxième tâche\.|Pour finir, voici la troisième tâche\.)/.test(text);
