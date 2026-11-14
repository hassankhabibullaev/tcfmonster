// Messages: the person's one thread with the owner (GET/POST /api/messages, /api/messages/read, the unread count on
// /api/me) and the owner's side (/api/admin/threads: the inbox, a thread, read, an answer tied to a report that marks it
// done), the guards (signed in, 2 000 characters, 30 a day, the hold line, someone else's report), and a deleted
// person takes their thread along.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setup, teardown, ADMIN, type QA } from "./helpers.ts";
import { BUDGET_HOLD, day } from "../../worker/util.ts";
import { MESSAGES_PER_DAY } from "../../worker/messages.ts";
import { dueReleases } from "../../web/app/release-due.ts";

let qa: QA, cookie: string, other: string, owner: string;
beforeEach(async () => {
  qa = setup({ OWNER_EMAIL: "owner@tcf.monster", ADMIN_OPEN: "0" });
  cookie = await qa.signUp("a@b.com");
  other = await qa.signUp("c@d.com");
  owner = await qa.signUp("owner@tcf.monster");
});
afterEach(teardown);

const write = (body: unknown, c = cookie) => qa.call("/api/messages", { body, cookie: c });
const report = (n: number, c = cookie) =>
  qa.call("/api/disputes", { body: { section: "co", level: "B1", questionId: `q-${n}`, n, message: `La question ${n} est fausse.` }, cookie: c });
const admin = (path: string, body?: unknown) => qa.call(`/api/admin${path}`, { host: ADMIN, cookie: owner, body });

describe("the person's thread", () => {
  it("holds their messages and their reports by date, the owner's answer tied to a report, and the unread dot", async () => {
    const r = (await report(12)).data.id as number;
    expect((await write({ body: "Bonjour, une idée : un mode sombre pour les examens ?" })).status).toBe(201);
    let t = (await qa.call("/api/messages", { cookie })).data;
    expect(t.unread).toBe(0);
    expect(t.items.map((i: { kind: string }) => i.kind)).toEqual(["report", "message"]);
    expect(t.items[0]).toMatchObject({ kind: "report", id: r, section: "co", level: "B1", n: 12, status: "open", body: "La question 12 est fausse." });
    expect(t.items[1]).toMatchObject({ kind: "message", fromOwner: false, disputeId: null });

    // the owner answers the report and marks it done in one go
    const sent = await admin(`/threads/${qa.userId("a@b.com")}/send`, { body: "Merci ! Corrigé.", disputeId: r, resolve: true });
    expect(sent.status).toBe(200);
    expect(qa.raw.prepare("SELECT status, note FROM disputes WHERE id = ?").get(r)).toMatchObject({ status: "resolved", note: "Merci ! Corrigé." });
    // answering is reading
    expect(qa.count("SELECT COUNT(*) n FROM messages WHERE from_owner = 0 AND read_at IS NULL")).toBe(0);

    expect((await qa.call("/api/me", { cookie })).data.unread).toBe(1);
    t = (await qa.call("/api/messages", { cookie })).data;
    expect(t.unread).toBe(1);
    expect(t.items[2]).toMatchObject({ kind: "message", fromOwner: true, disputeId: r, body: "Merci ! Corrigé.", readAt: null });
    expect(t.items[0].status).toBe("resolved");
    // opening the page reads it: the dot goes
    expect((await qa.call("/api/messages/read", { body: {}, cookie })).status).toBe(200);
    expect((await qa.call("/api/me", { cookie })).data.unread).toBe(0);

    // nobody else sees any of it
    const theirs = (await qa.call("/api/messages", { cookie: other })).data;
    expect(theirs).toEqual({ items: [], unread: 0, limit: { perDay: 5, left: 5, resetAt: null } });
  });

  it("a follow-up may name the person's own report, never someone else's", async () => {
    const mine = (await report(3)).data.id as number;
    const notMine = (await report(4, other)).data.id as number;
    expect((await write({ body: "J'ajoute : l'audio coupe aussi.", disputeId: mine })).status).toBe(201);
    expect((await write({ body: "x", disputeId: notMine })).status).toBe(400);
    expect((await write({ body: "x", disputeId: "abc" })).status).toBe(400);
    expect(qa.raw.prepare("SELECT dispute_id FROM messages WHERE from_owner = 0").all()).toEqual([{ dispute_id: mine }]);
  });

  it("refuses what is not a message", async () => {
    expect((await qa.call("/api/messages", { body: { body: "hi" } })).status).toBe(401);
    expect((await qa.call("/api/messages")).status).toBe(401);
    expect((await write({ body: "   " })).status).toBe(400);
    expect((await write({ body: 5 })).status).toBe(400);
    expect((await write({ body: "x".repeat(2001) })).data.error).toBe("too_long");
    expect((await write({ body: "x".repeat(2000) })).status).toBe(201);
    expect((await qa.call("/api/messages", { raw: "not json", cookie, headers: { "content-type": "application/json" } })).status).toBe(400);
    expect((await qa.call("/api/messages", { method: "PUT", body: {}, cookie })).status).toBe(405);
    expect((await qa.call("/api/messages", { body: { body: "hi" }, cookie, origin: "https://evil.example" })).status).toBe(403);
    expect(qa.count("SELECT COUNT(*) n FROM messages")).toBe(1);
  });

  it(`at most ${MESSAGES_PER_DAY} a person a day; none past the hold line`, async () => {
    expect(MESSAGES_PER_DAY).toBe(5);
    expect((await qa.call("/api/messages", { cookie })).data.limit).toEqual({ perDay: 5, left: 5, resetAt: null });
    for (let i = 0; i < MESSAGES_PER_DAY; i++) {
      const r = await write({ body: `m${i}` });
      expect(r.status).toBe(201);
      expect(r.data.limit.left).toBe(MESSAGES_PER_DAY - 1 - i); // the page shows what is left after each one
    }
    const over = await write({ body: "one more" });
    expect(over.status).toBe(429);
    expect(over.data.error).toBe("daily_cap");
    // none left: the answer says when the next one may go (the oldest of the five, a day later)
    const first = (qa.raw.prepare("SELECT MIN(created_at) t FROM messages WHERE from_owner = 0").get() as { t: string }).t;
    const limit = (await qa.call("/api/messages", { cookie })).data.limit;
    expect(limit).toEqual({ perDay: 5, left: 0, resetAt: new Date(Date.parse(first) + 86400000).toISOString() });
    expect(over.data.limit).toEqual(limit);
    // the owner's answers and the person's reports do not count
    await admin(`/threads/${qa.userId("a@b.com")}/send`, { body: "Bonjour" });
    expect((await report(1)).status).toBe(201);
    // a day later the oldest no longer counts
    qa.raw.prepare("UPDATE messages SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = (SELECT MIN(id) FROM messages WHERE from_owner = 0)").run();
    expect((await qa.call("/api/messages", { cookie })).data.limit).toMatchObject({ left: 1, resetAt: null });
    expect((await write({ body: "again" })).status).toBe(201);
    expect((await write({ body: "me too" }, other)).status).toBe(201);
    qa.raw.prepare("INSERT INTO budget (day, writes) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET writes = excluded.writes").run(day("Asia/Tashkent"), BUDGET_HOLD);
    expect((await write({ body: "held" }, other)).data.error).toBe("hold");
  });
});

describe("the owner's Messages", () => {
  it("lists the threads waiting first, opens one, reads it, and the Overview counts what waits", async () => {
    await write({ body: "Bonjour !" });
    await report(7, other);
    expect((await admin("/overview")).data.needs.messagesUnread).toBe(1);
    let inbox = (await admin("/threads")).data;
    expect(inbox.threads).toHaveLength(2);
    expect(inbox).toMatchObject({ unread: 1, open: 1, filter: "waiting" });
    const a = inbox.threads.find((t: { email: string }) => t.email === "a@b.com");
    expect(a).toMatchObject({ unread: 1, open: 0, last: { text: "Bonjour !", fromOwner: false, kind: "message" } });
    const c = inbox.threads.find((t: { email: string }) => t.email === "c@d.com");
    expect(c).toMatchObject({ unread: 0, open: 1, last: { kind: "report" } });

    const one = (await admin(`/threads/${qa.userId("a@b.com")}`)).data;
    expect(one.person.email).toBe("a@b.com");
    expect(one.items).toHaveLength(1);
    expect((await admin(`/threads/${qa.userId("a@b.com")}/read`, {})).status).toBe(200);
    inbox = (await admin("/threads")).data;
    // read and nothing open: no longer waiting, still in « All »
    expect(inbox.threads.map((t: { email: string }) => t.email)).toEqual(["c@d.com"]);
    expect((await admin("/threads?filter=all")).data.threads).toHaveLength(2);
    expect((await admin("/overview")).data.needs.messagesUnread).toBe(0);
  });

  it("refuses an empty answer, a report of someone else, an unknown person, and anyone but the owner", async () => {
    const theirs = (await report(9, other)).data.id as number;
    const a = qa.userId("a@b.com");
    expect((await admin(`/threads/${a}/send`, { body: "  " })).status).toBe(400);
    expect((await admin(`/threads/${a}/send`, { body: "x".repeat(2001) })).data.error).toBe("too_long");
    expect((await admin(`/threads/${a}/send`, { body: "x", disputeId: theirs })).status).toBe(400);
    expect((await admin("/threads/nobody/send", { body: "x" })).status).toBe(404);
    expect((await admin("/threads/nobody")).status).toBe(404);
    expect((await qa.call(`/api/admin/threads/${a}/send`, { host: ADMIN, cookie, body: { body: "x" } })).status).toBe(403);
    expect((await qa.call(`/api/admin/threads`, { cookie: owner })).status).toBe(404); // not on the app's address
    expect(qa.count("SELECT COUNT(*) n FROM messages")).toBe(0);
  });

  it("a deleted person takes their thread along", async () => {
    await write({ body: "Bonjour" });
    await admin(`/threads/${qa.userId("a@b.com")}/send`, { body: "Bonjour !" });
    expect(qa.count("SELECT COUNT(*) n FROM messages")).toBe(2);
    expect((await admin(`/people/${qa.userId("a@b.com")}/delete`, { confirm: "a@b.com" })).status).toBe(200);
    expect(qa.count("SELECT COUNT(*) n FROM messages")).toBe(0);
  });
});

describe("a report's status, told in the person's chat", () => {
  it("done or open again from the Disputes page leaves a row in their thread, with the owner's words, and lights the dot", async () => {
    const r = (await report(5)).data.id as number;
    expect((await admin(`/disputes/${r}/resolve`, { note: "La clé était juste : B." })).status).toBe(200);
    let t = (await qa.call("/api/messages", { cookie })).data;
    expect(t.unread).toBe(1);
    expect(t.items.at(-1)).toMatchObject({ kind: "message", fromOwner: true, disputeId: r, event: "resolved", body: "La clé était juste : B." });
    expect(t.items[0]).toMatchObject({ kind: "report", status: "resolved" });
    // the same status again changes nothing and says nothing
    expect((await admin(`/disputes/${r}/resolve`, {})).data.unchanged).toBe(true);
    expect((await admin(`/disputes/${r}/reopen`, {})).status).toBe(200);
    t = (await qa.call("/api/messages", { cookie })).data;
    expect(t.items.at(-1)).toMatchObject({ event: "reopened", body: "" });
    expect(t.items[0].status).toBe("open");
    // without words: the status alone
    await admin(`/disputes/${r}/resolve`, {});
    expect((await qa.call("/api/messages", { cookie })).data.items.at(-1)).toMatchObject({ event: "resolved", body: "" });
    expect(qa.count("SELECT COUNT(*) n FROM messages WHERE dispute_id = ?", r)).toBe(3);
    expect((await admin("/disputes/999/resolve", {})).status).toBe(404);
  });

  it("an answer from the chat that closes the report is one row: the words and « done »; a plain answer is no status", async () => {
    const r = (await report(6)).data.id as number;
    const a = qa.userId("a@b.com");
    await admin(`/threads/${a}/send`, { body: "Nous regardons.", disputeId: r });
    await admin(`/threads/${a}/send`, { body: "Corrigé, merci !", disputeId: r, resolve: true });
    // closing a report already done: the words go, no second « done »
    await admin(`/threads/${a}/send`, { body: "Et merci encore.", disputeId: r, resolve: true });
    const msgs = (await qa.call("/api/messages", { cookie })).data.items.filter((i: { kind: string }) => i.kind === "message");
    expect(msgs.map((m: { body: string; event: string | null }) => [m.body, m.event])).toEqual([["Nous regardons.", null], ["Corrigé, merci !", "resolved"], ["Et merci encore.", null]]);
  });
});

describe("the release note when several releases wait", () => {
  const L = [
    { id: "r3", date: "2026-11-12", forNew: false, party: false, row: { fr: "", en: "" } },
    { id: "r2", also: ["r2-old"], date: "2026-11-11", forNew: true, party: true, row: { fr: "", en: "" } },
    { id: "r1", date: "2026-10-30", forNew: false, party: false, row: { fr: "", en: "" } },
  ];
  const ids = (seen: string | null, joined: string | null, today = "2026-11-12") => dueReleases(seen, joined, today, L).map((r) => r.id);
  it("shows what came since this browser last closed it, newest first, in one window", () => {
    expect(ids(null, "2026-01-01")).toEqual(["r3", "r2", "r1"]);
    expect(ids("r1", "2026-01-01")).toEqual(["r3", "r2"]);
    expect(ids("r2-old", "2026-01-01")).toEqual(["r3"]);
    expect(ids("r3", "2026-01-01")).toEqual([]);
  });
  it("a fix is no news to an account made after it; old releases stay on the changes page", () => {
    expect(ids(null, "2026-11-11T09:00:00Z")).toEqual(["r3", "r2"]);
    expect(ids(null, "2026-11-12T09:00:00Z")).toEqual(["r2"]);
    expect(ids(null, "2026-01-01", "2027-01-30")).toEqual([]);
    expect(ids(null, "2026-01-01", "2026-12-20")).toEqual(["r3", "r2"]);
    // a release dated in the future waits for its day
    expect(ids(null, "2026-01-01", "2026-11-11")).toEqual(["r2", "r1"]);
  });
});
