import { Button } from "../../ui/ui";
import { Hall } from "./hallway";
export function BusyOverlay({ message, steps, detail, error, onRetry, retryLabel = "Retry", lang }: {
    message: string | null;
    steps?: string[];
    detail?: string | null;
    error?: string | null;
    onRetry?: () => void;
    retryLabel?: string;
    lang?: "fr" | "en";
}) {
    void steps;
    void detail;
    if (!message)
        return null;
    return <Hall title={message} sub={error ?? undefined} busy={!error} actions={error && onRetry ? <Button size="sm" onClick={onRetry}>{retryLabel}</Button> : undefined} lang={lang}/>;
}
