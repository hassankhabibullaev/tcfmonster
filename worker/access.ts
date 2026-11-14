// The admin's second lock. Cloudflare Access stands in front of admin.tcf.monster (the owner's e-mail, a one-time code)
// and signs every request it lets through (Cf-Access-Jwt-Assertion, RS256, the team's keys at /cdn-cgi/access/certs).
// The Worker checks that signature, the admin application's audience tag, the expiry and the e-mail: a request that
// reached the Worker without passing Access finds the admin shut even with the owner's session cookie. Off where
// ACCESS_TEAM and ACCESS_AUD are not set (tests, this Mac). ACCESS_TEAM may name several team domains, comma-separated:
// while the team's address is being renamed in the dashboard, the old one and the new one both sign valid tokens.
import { type Env } from "./util.ts";

const cache = new Map<string, { at: number; keys: Map<string, CryptoKey> }>();
async function keysOf(team: string): Promise<Map<string, CryptoKey>> {
  const hit = cache.get(team);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`access certs ${r.status}`);
  const d = (await r.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of d.keys ?? []) if (k.kid && k.kty === "RSA") keys.set(k.kid, await crypto.subtle.importKey("jwk", k, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  cache.set(team, { at: Date.now(), keys });
  return keys;
}
export const resetAccessKeys = () => { cache.clear(); };
/** the team domains the admin trusts */
export const teamsOf = (env: Env) => (env.ACCESS_TEAM ?? "").split(",").map((t) => t.trim()).filter(Boolean);

const bytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const part = (s: string) => { try { return JSON.parse(new TextDecoder().decode(bytes(s))) as Record<string, unknown>; } catch { return null; } };

/** did this request come through Cloudflare Access, signed in as the owner? (fails closed) */
export async function passedAccess(env: Env, req: Request): Promise<boolean> {
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return true;
  const token = req.headers.get("cf-access-jwt-assertion") ?? "";
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig || token.length > 8192) return false;
  const head = part(h), body = part(p);
  if (!head || !body || head.alg !== "RS256" || typeof head.kid !== "string") return false;
  // the token names its team; only a team on the list is asked for its keys
  const team = teamsOf(env).find((t) => body.iss === `https://${t}`);
  if (!team) return false;
  try {
    const key = (await keysOf(team)).get(head.kid);
    if (!key || !(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(sig), new TextEncoder().encode(`${h}.${p}`)))) return false;
  } catch { return false; }
  const aud = Array.isArray(body.aud) ? body.aud : [body.aud];
  const now = Date.now() / 1000;
  return aud.includes(env.ACCESS_AUD) && typeof body.exp === "number" && body.exp > now
    && typeof body.email === "string" && isOwnerEmail(env, body.email);
}

/** the owner's address, however it is typed (case, spaces) */
export const isOwnerEmail = (env: Env, email: string) => !!env.OWNER_EMAIL && email.trim().toLowerCase() === env.OWNER_EMAIL.trim().toLowerCase();
