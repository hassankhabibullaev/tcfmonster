import { isFixedLine } from "./oral-core.ts";
import type { Turn } from "./types.ts";
export function continuityNote(tasks: {
    taskNo: number;
    turns: Turn[];
}[], taskNo: number): string {
    const bits: string[] = [];
    for (const t of tasks.filter((x) => x.taskNo < taskNo).sort((a, b) => a.taskNo - b.taskNo)) {
        const said = t.turns.filter((u) => u.role === "candidate" && u.text && u.text !== "(inaudible)").map((u) => u.text);
        if (!said.length)
            continue;
        bits.push(t.taskNo === 1 ? `Tâche 1 (entretien), le candidat s'est présenté ainsi : « ${said.join(" ").slice(0, 600)} »` : `Tâche ${t.taskNo} : faite (${said.length} prises de parole).`);
    }
    return bits.length ? `# Ce qui s'est déjà passé dans cette épreuve\n${bits.join("\n")}\nTu le sais : tu ne redemandes pas ce qu'il a déjà dit de lui, et tu peux y faire référence d'un mot si c'est naturel.` : "";
}
export function resumeNote(turns: Turn[]): string {
    const said = turns.filter((u) => u.text && u.text !== "(inaudible)" && !isFixedLine(u.text)).slice(-12);
    if (!said.length)
        return "";
    const lines = said.map((u) => `${u.role === "examiner" ? "Toi" : "Le candidat"} : ${u.text.slice(0, 300)}`).join("\n");
    return `# La connexion a été coupée un instant : l'échange REPREND
Voici ce qui a déjà été dit (le plus récent en dernier). Tu continues exactement là où ça s'est arrêté, dans le même rôle, sans te représenter, sans recommencer l'introduction, sans commenter la coupure.
${lines}`;
}
