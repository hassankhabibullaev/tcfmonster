import type { ReactNode } from "react";
import { BackLink, Icon, BetaTag, Wordmark } from "../../ui/ui.tsx";
import { useT } from "../i18n.ts";
import { LangSwitch, ThemeSwitch } from "../Frame.tsx";
export function LangPill() {
    return <span className="auth-switches"><LangSwitch dir="left"/><ThemeSwitch /></span>;
}
export function AuthShell({ children, step, hero = "full" }: {
    children: ReactNode;
    step?: string;
    hero?: "full" | "small";
}) {
    const { t, lang } = useT();
    return (<div className="auth">
      <aside className="auth-pitch">
        <a href="/about" className="auth-brand"><img className="auth-icon" src="/app-icon.svg" alt="" width="56" height="56"/><Wordmark /><BetaTag lang={lang}/></a>
        <div className="auth-pitch-body">
          <h2>{t.pitchTitle}</h2>
          <ul>
            {[t.pitch1, t.pitch2, t.pitch3].map((p) => <li key={p}><span className="tick"><Icon name="check" size={16}/></span>{p}</li>)}
          </ul>
        </div>
        <BackLink href="/about" label={t.backToSite}/>
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-top">
          <a href="/about" className="brand mob-only"><img className="logo" src="/app-icon.svg" alt="" width="30" height="30"/><Wordmark /><BetaTag lang={lang}/></a>
          <span className="spacer"/>
          {step && <span className="muted small">{step}</span>}
          <LangPill />
        </div>
        <section className={`auth-hero hero-${hero}`} aria-label={t.pitchTitle}>
          <h2>{t.pitchTitle}</h2>
          {hero === "full" && (<ul>
              {[t.pitch1, t.pitch2, t.pitch3].map((p) => <li key={p}><span className="tick"><Icon name="check" size={14}/></span>{p}</li>)}
            </ul>)}
        </section>
        <div className="auth-card">{children}</div>
      </main>
    </div>);
}
export function Field({ label, error, children, id }: {
    label: string;
    error?: string | null;
    children: ReactNode;
    id: string;
}) {
    return (<div className="afield">
      <label htmlFor={id}>{label}</label>
      {children}
      <span className="afield-error" role={error ? "alert" : undefined} id={`${id}-error`}>{error ?? ""}</span>
    </div>);
}
