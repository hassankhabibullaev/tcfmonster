import { Button, Icon } from "../../ui/ui";
import { useSimWords } from "./words";
import type { Lang } from "../i18n";
export type TroubleProps = {
    message: string;
    final?: boolean;
    retryIn?: number | null;
    onRetry?: () => void;
    onQuit?: () => void;
    link?: {
        label: string;
        href: string;
    };
    busy?: boolean;
    lang: Lang;
};
export function Trouble({ message, final = false, retryIn = null, onRetry, onQuit, link, busy = false, lang }: TroubleProps) {
    const w = useSimWords(lang);
    return (<div className="trouble" role="status" aria-live="polite">
      <Icon name="alert" size={22}/>
      <div className="trouble-body">
        <p>{final ? w.troubleGoogle : message}</p>
        {retryIn != null && retryIn > 0 && !final && <p className="trouble-count num">{w.retryingIn(retryIn)}</p>}
        <div className="trouble-acts">
          {link && <a className="btn sm" href={link.href}>{link.label}</a>}
          {(final || !!onQuit) && onQuit && <Button size="sm" kind="quiet" onClick={onQuit}>{w.quit}</Button>}
          {onRetry && <Button size="sm" kind="primary" busy={busy} onClick={onRetry}>{w.retry}</Button>}
        </div>
      </div>
    </div>);
}
export function minutesLabel(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s ? `${m} min ${String(s).padStart(2, "0")}` : `${m} min`;
}
