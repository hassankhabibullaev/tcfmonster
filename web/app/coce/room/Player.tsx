import { useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type Ref } from "react";
import { Button, Icon } from "../../../ui/ui.tsx";
import type { Lang } from "../../i18n.ts";
import { useRoomWords } from "./words.ts";
import { fmtTime } from "./hooks.ts";
export type PlayerHandle = {
    audio: HTMLAudioElement | null;
    seek: (t: number | ((duration: number) => number), play?: boolean) => void;
    toggle: () => void;
    play: () => void;
    pause: () => void;
};
export type PlayerProps = {
    src: string;
    resetKey: string;
    maxPlays: number | null;
    scrubber: boolean;
    autoplay: boolean;
    lang: Lang;
    locked?: boolean;
    onEnded?: () => void;
    onError?: () => void;
    onPlays?: (n: number) => void;
    preload?: "auto" | "none";
    ref?: Ref<PlayerHandle>;
};
export function Player({ src, resetKey, maxPlays, scrubber, autoplay, lang, locked = false, onEnded, onError, onPlays, preload = "auto", ref }: PlayerProps) {
    const w = useRoomWords(lang);
    const audio = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [t, setT] = useState(0);
    const [dur, setDur] = useState(0);
    const [plays, setPlays] = useState(0);
    const [ended, setEnded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [tries, setTries] = useState(0);
    const cb = useRef({ onEnded, onError, onPlays });
    cb.current = { onEnded, onError, onPlays };
    const whole = src.startsWith("/media/");
    const [held, setHeld] = useState<{
        src: string;
        tries: number;
        url: string;
    } | null>(null);
    const url = !whole ? src : held && held.src === src && held.tries === tries ? held.url : null;
    const urlRef = useRef(url);
    urlRef.current = url;
    const [want, setWant] = useState(preload !== "none");
    const pending = useRef<null | (() => void)>(null);
    useEffect(() => { setWant(preload !== "none"); pending.current = null; }, [src, preload]);
    useEffect(() => {
        if (!whole || !want)
            return;
        let gone = false, made = "";
        fetch(src)
            .then((r) => { if (!r.ok)
            throw new Error(String(r.status)); return r.blob(); })
            .then((b) => { if (gone)
            return; made = URL.createObjectURL(b); setHeld({ src, tries, url: made }); })
            .catch(() => { if (!gone)
            setHeld({ src, tries, url: src }); });
        return () => { gone = true; if (made)
            URL.revokeObjectURL(made); };
    }, [src, whole, want, tries]);
    const retried = useRef("");
    const whenReady = (fn: () => void) => { if (url)
        fn();
    else {
        pending.current = fn;
        setWant(true);
    } };
    const exhausted = maxPlays !== null && plays >= maxPlays && !playing && (ended || t === 0);
    useEffect(() => {
        setPlaying(false);
        setT(0);
        setDur(0);
        setPlays(0);
        setEnded(false);
        setFailed(false);
        audio.current?.pause();
    }, [resetKey, tries]);
    useEffect(() => {
        const a = audio.current;
        if (!a || !url)
            return;
        a.load();
        const go = pending.current;
        pending.current = null;
        if (go) {
            a.addEventListener("loadedmetadata", go, { once: true });
            return () => a.removeEventListener("loadedmetadata", go);
        }
        if (!autoplay)
            return;
        const id = setTimeout(() => { a.play().catch(() => { }); }, 350);
        return () => clearTimeout(id);
    }, [url, resetKey]);
    useEffect(() => {
        const a = audio.current;
        if (!a || !playing)
            return;
        let raf = 0;
        const tick = () => { setT(a.currentTime); raf = requestAnimationFrame(tick); };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [playing]);
    useEffect(() => {
        const stop = () => audio.current?.pause();
        const onVis = () => { if (document.hidden)
            stop(); };
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("pagehide", stop);
        return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", stop); stop(); };
    }, []);
    const play = () => { const a = audio.current; if (!a || failed || exhausted)
        return; whenReady(() => { a.play().catch(() => { }); }); };
    const pause = () => { if (locked)
        return; audio.current?.pause(); };
    const toggle = () => { const a = audio.current; if (!a)
        return; if (a.paused)
        play();
    else
        pause(); };
    const seek = (to: number | ((duration: number) => number), go = true) => {
        const a = audio.current;
        if (!a || failed)
            return;
        const run = () => {
            const at = typeof to === "function" ? to(Number.isFinite(a.duration) ? a.duration : 0) : to;
            a.currentTime = Math.max(0, at);
            setT(a.currentTime);
            if (go)
                a.play().catch(() => { });
        };
        if (!url) {
            whenReady(run);
            return;
        }
        if (a.readyState >= 1)
            run();
        else {
            a.addEventListener("loadedmetadata", run, { once: true });
            a.load();
        }
    };
    useImperativeHandle(ref, () => ({ get audio() { return audio.current; }, seek, toggle, play, pause }));
    const pct = dur > 0 ? Math.min(100, (t / dur) * 100) : 0;
    const fill = { "--p": `${pct}%` } as CSSProperties;
    return (<div className="cr-player" data-locked={locked || undefined} data-failed={failed || undefined}>
      <audio ref={audio} src={url ?? undefined} preload={preload} onPlay={(e) => {
            setPlaying(true);
            setEnded(false);
            const a = e.currentTarget;
            if (a.currentTime < 0.3)
                setPlays((n) => { cb.current.onPlays?.(n + 1); return n + 1; });
            document.querySelectorAll("audio").forEach((x) => { if (x !== a)
                x.pause(); });
        }} onPause={() => setPlaying(false)} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} onDurationChange={(e) => setDur(e.currentTarget.duration)} onEnded={() => { setPlaying(false); setEnded(true); cb.current.onEnded?.(); }} onError={(e) => {
            if (!urlRef.current || e.currentTarget.getAttribute("src") !== urlRef.current)
                return;
            if (retried.current !== resetKey) {
                retried.current = resetKey;
                setTries((n) => n + 1);
                return;
            }
            setFailed(true);
            setPlaying(false);
            cb.current.onError?.();
        }}/>
      <div className="cr-pill">
        {failed ? (<div className="cr-player-failed" role="status">
            <span>{w.audioUnavailable}</span>
            <Button size="sm" icon="refresh" onClick={() => setTries((n) => n + 1)}>{w.retry}</Button>
          </div>) : (<>
            <button type="button" className="cr-play" onClick={toggle} disabled={(locked && playing) || exhausted} aria-label={playing ? w.pause : w.play} aria-pressed={playing}>
              <Icon name={playing ? "pause" : "play"} size={16} className="icon-fill"/>
            </button>
            {scrubber ? (<input type="range" className="cr-scrub" style={fill} min={0} max={dur > 0 ? dur : Math.max(t, 1)} step="any" value={dur > 0 ? Math.min(t, dur) : t} aria-label={w.position} onChange={(e) => seek(Number(e.target.value), playing)}/>) : (<div className="cr-progress" aria-hidden="true"><i style={{ width: `${pct}%` }}/></div>)}
            <span className="cr-player-times num">{fmtTime(t)} / {fmtTime(dur)}</span>
          </>)}
      </div>
    </div>);
}
