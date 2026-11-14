import { Button, Sheet } from "../../ui/ui";
import { useSimWords } from "./words";
import type { Lang } from "../i18n";
export function FinishDialog({ open, tasks, secondsLeft, onBack, onFinish, lang }: {
    open: boolean;
    tasks: {
        taskNo: number;
        words: number;
        min: number;
        max: number;
    }[];
    secondsLeft: number;
    onBack: () => void;
    onFinish: () => void;
    lang: Lang;
}) {
    const w = useSimWords(lang);
    const min = Math.floor(secondsLeft / 60);
    return (<Sheet open={open} title={w.finishTitle} onClose={onBack} actions={<>
          <Button onClick={onBack} autoFocus>{w.continue}</Button>
          <Button kind="danger" onClick={onFinish}>{w.finish}</Button>
        </>}>
      <p>
        {tasks.length > 1 ? w.finishBodyMany : w.finishBodyOne}
        {min >= 1 ? ` ${w.minutesLeft(min)}` : ""}
      </p>
      <ul className="finish-list">
        {tasks.map((t) => {
            const state = t.words === 0 ? "empty" : t.words < t.min ? "under" : t.words > t.max ? "over" : "ok";
            return (<li key={t.taskNo} data-state={state}>
              <b>{w.taskN(t.taskNo)}</b>
              <span className="num">{w.words(t.words)}</span>
              <small>{state === "empty" ? w.noText : state === "under" ? w.underMin(t.min) : state === "over" ? w.overMax(t.max) : w.inRange}</small>
            </li>);
        })}
      </ul>
    </Sheet>);
}
