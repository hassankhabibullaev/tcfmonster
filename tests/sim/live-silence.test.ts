// A live socket that went dead without closing (N5, 2026-11-11: after Tâche 2's preparation the examiner « kept
// thinking »): `unanswered` tells it from one that is merely slow, and `drop` hands it to the runner as a cut.
import { describe, it, expect, vi, afterEach } from "vitest";
import { LiveExaminer } from "../../web/app/sim/live-examiner.ts";

type Inner = { lastPrompt: number; onMessage: (m: Record<string, unknown>) => void; ws: unknown };
function examiner(onClosed = vi.fn()) {
  const Ctor = LiveExaminer as unknown as new (h: object, mode: string) => LiveExaminer;
  const ex = new Ctor({ onClosed }, "live");
  // an open socket that takes whatever is sent
  (ex as unknown as Inner).ws = { readyState: 1, send: () => {}, close: () => {} };
  return { ex, inner: ex as unknown as Inner, onClosed };
}

afterEach(() => vi.useRealTimers());

describe("the live examiner's silent socket", () => {
  it("a turn handed over and nothing back from Google counts as unanswered once the time has passed", () => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "Date"] });
    const { ex, inner } = examiner();
    expect(ex.unanswered(0)).toBe(false); // nothing asked yet
    vi.advanceTimersByTime(1000); // the page has been open a moment (the faked clock starts at 0)
    inner.lastPrompt = performance.now();
    expect(ex.unanswered(12_000)).toBe(false); // too soon
    vi.advanceTimersByTime(12_001);
    expect(ex.unanswered(12_000)).toBe(true);
  });

  it("any message from Google after the turn — even a transcription or a resumption handle — means the socket lives", () => {
    vi.useFakeTimers({ toFake: ["performance", "setTimeout", "Date"] });
    const { ex, inner } = examiner();
    inner.lastPrompt = performance.now();
    vi.advanceTimersByTime(500);
    inner.onMessage({ sessionResumptionUpdate: { resumable: false } });
    vi.advanceTimersByTime(20_000);
    expect(ex.unanswered(12_000)).toBe(false);
    // a new turn handed over afterwards is unanswered again until something comes
    inner.lastPrompt = performance.now();
    vi.advanceTimersByTime(12_000);
    expect(ex.unanswered(12_000)).toBe(true);
    inner.onMessage({ serverContent: { inputTranscription: { text: "bonjour" } } });
    expect(ex.unanswered(0)).toBe(false);
  });

  it("drop closes the socket and tells the runner once, as a cut it reopens", () => {
    const { ex, onClosed } = examiner();
    ex.drop("no answer from Google");
    expect(ex.isClosed).toBe(true);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onClosed.mock.calls[0][0]).toBe("no answer from Google");
    ex.drop("again");
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});
