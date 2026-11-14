import { Button, Sheet } from "../../ui/ui";
import { useSimWords } from "./words";
import type { Lang } from "../i18n";
export function StopDialog({ open, canScore, onResume, onStop, onAbandon, lang }: {
    open: boolean;
    canScore: boolean;
    onResume: () => void;
    onStop: () => void;
    onAbandon: () => void;
    lang: Lang;
}) {
    const w = useSimWords(lang);
    return (<Sheet open={open} title={w.stopTitle} onClose={onResume} actions={<>
          <Button onClick={onResume} autoFocus>{w.resume}</Button>
          <span className="sim-acts">
            <Button kind="danger" onClick={onAbandon}>{w.abandon}</Button>
            {canScore && <Button kind="primary" onClick={onStop}>{w.stopAndScore}</Button>}
          </span>
        </>}>
      <p>{canScore ? w.stopBodyScore : w.stopBodyNone}</p>
    </Sheet>);
}
