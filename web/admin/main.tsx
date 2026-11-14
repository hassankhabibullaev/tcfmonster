import { StrictMode, useState, useCallback, useEffect, createContext, useContext } from "react";
import { createRoot } from "react-dom/client";
import "../ui/tokens.css";
import "../ui/base.css";
import "./admin.css";
import { Icon, Wordmark, Toast, type IconName } from "../ui/ui.tsx";
import { useLocation, linkProps } from "./lib.ts";
import { Today } from "./pages/Today.tsx";
import { People } from "./pages/People.tsx";
import { Person } from "./pages/Person.tsx";
import { Disputes, Dispute } from "./pages/Disputes.tsx";
import { Messages } from "./pages/Messages.tsx";

const NAV: [string, string, IconName][] = [
  ["/", "Today", "home"],
  ["/people", "People", "users"],
  ["/reports", "Reports", "flag"],
  ["/messages", "Messages", "chat"],
];

// light or dark: light unless this device chose dark (the same key as the app, on its own origin)
type Theme = "light" | "dark";
const readTheme = (): Theme => { try { return localStorage.getItem("tcfm-theme") === "dark" ? "dark" : "light"; } catch { return "light"; } };
const paintTheme = (th: Theme) => { document.documentElement.dataset.theme = th; try { localStorage.setItem("tcfm-theme", th); } catch { /* private window */ } };
paintTheme(readTheme());

function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const dark = theme === "dark";
  const flip = () => { const th: Theme = dark ? "light" : "dark"; setTheme(th); paintTheme(th); };
  return (
    <button type="button" className="theme-switch" onClick={flip} aria-label={dark ? "Light mode" : "Dark mode"} title={dark ? "Light mode" : "Dark mode"}>
      <Icon name={dark ? "sun" : "moon"} size={20} />
    </button>
  );
}

type ToastState = { text: string; tone?: "ok" | "bad" } | null;
const ToastContext = createContext<(text: string, tone?: "ok" | "bad") => void>(() => {});
export const useToast = () => useContext(ToastContext);

/** the admin opens only to the owner's sign-in, made on tcf.monster (one cookie for both) */
function Locked() {
  return (
    <main className="locked">
      <img className="logo" src="/app-icon.svg" alt="" width="56" height="56" />
      <Wordmark />
      <h1 className="title">Admin</h1>
      <p className="muted">Sign in with the owner's account, then come back here.</p>
      <a className="btn primary" href="https://tcf.monster/sign-in">Sign in</a>
    </main>
  );
}

function App() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  useEffect(() => { fetch("/api/admin/overview").then((r) => setAllowed(r.status !== 403)).catch(() => setAllowed(true)); }, []);
  if (allowed === false) return <Locked />;
  if (allowed === null) return null;
  return <Admin />;
}

function Admin() {
  // « Reports » was « Disputes »: its old addresses still open
  const path = useLocation().path.replace(/^\/disputes(?=\/|$)/, "/reports");
  const [toast, setToast] = useState<ToastState>(null);
  const say = useCallback((text: string, tone?: "ok" | "bad") => setToast({ text, tone }), []);
  const clear = useCallback(() => setToast(null), []);
  const section = path.startsWith("/messages") ? "/messages" : path.startsWith("/reports") ? "/reports" : path.startsWith("/people") ? "/people" : "/";
  const person = path.match(/^\/people\/([\w-]+)$/)?.[1];
  const dispute = path.match(/^\/reports\/(\d+)$/)?.[1];

  let page;
  if (path === "/") page = <Today />;
  else if (path === "/people") page = <People />;
  else if (person) page = <Person id={person} />;
  else if (path === "/messages" || /^\/messages\/[\w-]+$/.test(path)) page = <Messages id={path.split("/")[2] ?? null} />;
  else if (path === "/reports") page = <Disputes />;
  else if (dispute) page = <Dispute id={Number(dispute)} />;
  else page = <div className="page"><h1 className="title">Not found</h1><a className="link" {...linkProps("/")}>Today</a></div>;

  return (
    <ToastContext.Provider value={say}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="bar">
        <div className="bar-in">
          <a className="brand" {...linkProps("/")} aria-label="tcf.monster admin, today">
            <img className="logo" src="/app-icon.svg" alt="" width="32" height="32" /><Wordmark /><span className="brand-tag">admin</span>
          </a>
          <nav className="nav" aria-label="Admin">
            {NAV.map(([to, label, icon]) => (
              <a key={to} {...linkProps(to)} aria-current={section === to ? "page" : undefined}>
                <Icon name={icon} size={18} /><span>{label}</span>
              </a>
            ))}
          </nav>
          <span className="spacer" />
          <ThemeSwitch />
          <a className="bar-link desk" href="https://tcf.monster/about" target="_blank" rel="noopener">tcf.monster <Icon name="external" size={14} /></a>
        </div>
      </header>
      <main id="main">{page}</main>
      {toast && <Toast text={toast.text} tone={toast.tone} onDone={clear} />}
    </ToastContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
