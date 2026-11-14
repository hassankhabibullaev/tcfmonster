import { useState, type FormEvent } from "react";
import { Icon } from "../../ui/ui.tsx";
import { useT } from "../i18n.ts";
import { api } from "../api.ts";
import "./donate.css";
const PRESET = 5;
const CURRENCY = "usd";
const WORDS = {
    fr: {
        title: "Garder tcf.monster gratuit",
        body: "Un don paie le nom de domaine, l'hébergement et l'entretien, pour que tout reste gratuit et en ligne pour tout le monde.",
        go: "Faire un don", goShort: "Donner", bodyShort: "Un don paie le domaine et l'hébergement", secure: "Paiement sécurisé · Ko-fi / Stripe", error: "Le paiement n'est pas disponible pour l'instant.",
    },
    en: {
        title: "Keep tcf.monster free",
        body: "A donation pays the domain, the hosting and the upkeep, so that everything stays free and online for everyone.",
        go: "Donate", goShort: "Donate", bodyShort: "A donation pays the domain and the hosting", secure: "Secure payment · Ko-fi / Stripe", error: "Payment is not available right now.",
    },
};
export function DonateCard() {
    const { lang } = useT();
    const w = WORDS[lang];
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    async function submit(e: FormEvent) {
        e.preventDefault();
        setBusy(true);
        setFailed(false);
        const tab = window.open("", "_blank");
        try {
            const { url } = await api<{
                url: string;
            }>("/donate", { amount: PRESET, currency: CURRENCY, kind: "once", lang });
            if (typeof url !== "string" || !/^https:\/\//.test(url))
                throw new Error("bad url");
            if (tab) {
                tab.opener = null;
                tab.location.href = url;
            }
            else
                location.assign(url);
        }
        catch {
            tab?.close();
            setFailed(true);
        }
        finally {
            setBusy(false);
        }
    }
    return (<section className="dcard" aria-labelledby="dcard-title">
      <div className="dcard-text">
        <span className="dcard-icon"><Icon name="heart" size={22}/></span>
        <h2 id="dcard-title">{w.title}</h2>
        <p><span className="desk-only">{w.body}</span><span className="mob-only">{w.bodyShort}</span></p>
      </div>
      <form className="dcard-form" onSubmit={submit} noValidate>
        <p className="dcard-note" role={failed ? "alert" : undefined}>{failed ? w.error : <><Icon name="lock" size={12}/>{w.secure}</>}</p>
        <button type="submit" className="btn dgo" disabled={busy} aria-busy={busy || undefined}>
          {busy ? <span className="spin" aria-hidden="true"/> : <Icon name="heart" size={16}/>}<span className="desk-only">{w.go}</span><span className="mob-only">{w.goShort}</span>
        </button>
      </form>
    </section>);
}
