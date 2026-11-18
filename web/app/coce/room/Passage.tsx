import type { ReactNode } from "react";
import { Icon } from "../../../ui/ui.tsx";
import type { Lang } from "../../i18n.ts";
import { Switch } from "./Shell.tsx";
import { usePhone } from "./hooks.ts";
import { useRoomWords } from "./words.ts";
export function MiniSeg<T extends string>({ value, options, onChange, label, disabled }: {
    value: T;
    options: [
        T,
        string,
        boolean?
    ][];
    onChange: (v: T) => void;
    label: string;
    disabled?: boolean;
}) {
    return (<span className="cr-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l, off]) => <button key={v} type="button" role="radio" aria-checked={v === value} disabled={disabled || off} onClick={() => onChange(v)}>{l}</button>)}
    </span>);
}
export function Fold({ title, open, onToggle, disabled = false, children }: {
    title: string;
    open: boolean;
    onToggle: (v: boolean) => void;
    disabled?: boolean;
    children: ReactNode;
}) {
    return (<section className="cr-fold" data-open={open || undefined}>
      <div className="cr-fold-head">
        <button type="button" className="cr-fold-btn" aria-expanded={open} disabled={disabled} onClick={() => onToggle(!open)}>{title}</button>
        <button type="button" className="cr-fold-chev" aria-label={title} aria-expanded={open} disabled={disabled} onClick={() => onToggle(!open)}><Icon name="chevronDown" size={16}/></button>
      </div>
      {open && !disabled && <div className="cr-fold-body">{children}</div>}
    </section>);
}
export type PassageProps = {
    text: string | null;
    textEn: string | null;
    english: boolean;
    highlight?: string | null;
    highlightEn?: string | null;
};
function marked(text: string, needle: string | null | undefined): ReactNode {
    if (!needle)
        return text;
    const i = text.indexOf(needle.trim());
    if (i < 0)
        return text;
    return <>{text.slice(0, i)}<mark className="cr-key">{text.slice(i, i + needle.trim().length)}</mark>{text.slice(i + needle.trim().length)}</>;
}
const paras = (s: string) => s.split(/\n+/).map((p) => p.trim()).filter(Boolean);
export function Paper({ lang, className, label = false, children }: {
    lang: "fr" | "en";
    className?: string;
    label?: boolean;
    children: ReactNode;
}) {
    const sheet = <div className={`cr-paper ${className ?? ""}`} lang={lang}>{children}</div>;
    return label ? <div className="cr-sheet"><LangTag lang={lang}/>{sheet}</div> : sheet;
}
export function LangTag({ lang }: {
    lang: "fr" | "en";
}) {
    return <span className="cr-langtag" aria-hidden="true">{lang.toUpperCase()}</span>;
}
export function Passage({ text, textEn, english, highlight, highlightEn }: PassageProps) {
    if (!text)
        return null;
    const both = english && !!textEn;
    return (<div className="cr-passage cr-papers">
      <Paper lang="fr" label={both}>{paras(text).map((p, i) => <p key={i}>{marked(p, highlight)}</p>)}</Paper>
      {both && <Paper lang="en" label className="cr-paper-en">{paras(textEn!).map((p, i) => <p key={i}>{marked(p, highlightEn)}</p>)}</Paper>}
    </div>);
}
export function hintNodes(text: string): ReactNode[] {
    const plain = (line: string) => line.replace(/\[\[([^\]]+)\]\]/g, "$1");
    const out: ReactNode[] = [];
    let list: string[] = [];
    const flush = () => { if (list.length) {
        out.push(<ul key={`l${out.length}`}>{list.map((l, j) => <li key={j}>{plain(l)}</li>)}</ul>);
        list = [];
    } };
    for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line)
            continue;
        if (line.startsWith("- "))
            list.push(line.slice(2));
        else {
            flush();
            out.push(<p key={`p${out.length}`}>{plain(line)}</p>);
        }
    }
    flush();
    return out;
}
export function Caution({ caution, lang }: {
    caution: {
        fr: string;
        en: string;
    } | null | undefined;
    lang: Lang;
}) {
    const w = useRoomWords(lang);
    const text = caution ? (lang === "en" ? caution.en || caution.fr : caution.fr || caution.en) : "";
    if (!text)
        return null;
    return (<div className="cr-caution" role="note">
      <Icon name="alert" size={18}/>
      <p><b>{w.caution}</b> {text}</p>
    </div>);
}
export function Hint({ hint, english, lang }: {
    hint: {
        fr: string;
        en: string;
    } | null;
    english: boolean;
    lang: Lang;
}) {
    const w = useRoomWords(lang);
    if (!hint)
        return null;
    return (<div className="cr-hint cr-papers">
      <p className="cr-hint-note">{w.hintNote}</p>
      {english && hint.en ? (<div className="cr-cols">
          <Paper lang="fr" label>{hintNodes(hint.fr)}</Paper>
          <Paper lang="en" label className="cr-paper-en">{hintNodes(hint.en)}</Paper>
        </div>) : <Paper lang="fr">{hintNodes(hint.fr)}</Paper>}
    </div>);
}
export function PanelBar({ children }: {
    children: ReactNode;
}) {
    return <div className="cr-panel-bar">{children}</div>;
}
export type PanelProps = {
    text: string | null;
    textEn: string | null;
    hint: {
        fr: string;
        en: string;
    } | null;
    showHint: boolean;
    english: boolean;
    onShowHint: (v: boolean) => void;
    onEnglish: (v: boolean) => void;
    highlight?: string | null;
    highlightEn?: string | null;
    lang: Lang;
};
export function Panel({ text, textEn, hint, showHint, english, onShowHint, onEnglish, highlight, highlightEn, lang }: PanelProps) {
    const w = useRoomWords(lang);
    const phone = usePhone();
    const hintView = showHint && !!hint;
    const canEn = hintView ? !!hint?.en : !!textEn;
    return (<>
      
      <PanelBar>
        {phone ? (<>
            <MiniSeg value={hintView ? "hint" : "text"} options={[["text", w.text], ["hint", w.hint, !hint]]} onChange={(v) => onShowHint(v === "hint")} label={w.view}/>
            <span className="spacer"/>
            <MiniSeg value={english ? "en" : "fr"} options={[["fr", "FR"], ["en", "EN", !canEn]]} onChange={(v) => onEnglish(v === "en")} label={w.english}/>
          </>) : (<>
            <Switch offLabel={w.fullText} label={w.shortHint} on={hintView} onChange={onShowHint} disabled={!hint}/>
            <MiniSeg value={english ? "en" : "fr"} options={[["fr", "FR"], ["en", "EN", !canEn]]} onChange={(v) => onEnglish(v === "en")} label={w.english}/>
          </>)}
      </PanelBar>
      <div className="cr-text">
        <div key={`${hintView ? "h" : "t"}${english ? "e" : ""}`} className="cr-panel-view">
          {hintView ? <Hint hint={hint} english={english} lang={lang}/> : <Passage text={text} textEn={textEn} english={english} highlight={highlight} highlightEn={highlightEn}/>}
        </div>
      </div>
    </>);
}
