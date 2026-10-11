/**
 * Regression tests for the Gemini retry budget.
 *
 * These exist because the guard has already been lost once: the commit that
 * added `.js` import extensions also reverted the time budget, which let the
 * retry chain run past Vercel's maxDuration. Vercel then killed the function
 * and returned an HTML crash page, so the browser showed "the server took too
 * long or crashed" with no usable detail.
 *
 * The timings below mirror a real production log:
 *   503 after 17.7s  ->  503 after 10.4s  ->  503 after 19.9s  -> killed at 60s
 */
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { callGemini, GEMINI_MODELS } from "../../api/_shared";

/** Virtual clock so budget logic can be tested without real waiting. */
function useVirtualClock() {
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    advance: (ms: number) => {
      now += ms;
    },
    elapsedFrom: (start: number) => now - start,
    get now() {
      return now;
    },
  };
}

const modelOf = (url: string) =>
  /models\/([^:]+):/.exec(url)?.[1] ?? "unknown";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callGemini time budget", () => {
  it("tries every model once before retrying any of them", async () => {
    const clock = useVirtualClock();
    const calls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(modelOf(url));
        clock.advance(1000);
        return jsonResponse(503, { error: "overloaded" });
      })
    );

    await callGemini({}, "key", { totalBudgetMs: 60000 });

    // Pass 1 must cover all three models before pass 2 repeats the first.
    expect(calls.slice(0, GEMINI_MODELS.length)).toEqual(GEMINI_MODELS);
    expect(new Set(calls.slice(0, GEMINI_MODELS.length)).size).toBe(GEMINI_MODELS.length);
  });

  it("reaches the healthy third model in the scenario that used to time out", async () => {
    const clock = useVirtualClock();
    const start = clock.now;
    const seen: string[] = [];

    // Exactly the production log: the first two models are overloaded and slow,
    // the third is healthy.
    const latency: Record<string, number> = {
      [GEMINI_MODELS[0]]: 17700,
      [GEMINI_MODELS[1]]: 19900,
      [GEMINI_MODELS[2]]: 12000,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const model = modelOf(url);
        seen.push(model);
        clock.advance(latency[model]);
        return model === GEMINI_MODELS[2]
          ? jsonResponse(200, { candidates: [{ finishReason: "STOP" }] })
          : jsonResponse(503, { error: "The model is overloaded." });
      })
    );

    const { response, model } = await callGemini({}, "key", { totalBudgetMs: 52000 });

    expect(seen).toEqual(GEMINI_MODELS); // third model actually got a turn
    expect(response.status).toBe(200);
    expect(model).toBe(GEMINI_MODELS[2]);
    // And it finished inside a 60s function limit.
    expect(clock.elapsedFrom(start)).toBeLessThan(60000);
  });

  it("never exceeds the budget and returns JSON rather than hanging", async () => {
    const clock = useVirtualClock();
    const start = clock.now;

    // Faithful to undici: a call that outruns its AbortSignal is cut off at the
    // cap rather than running to completion.
    let cap = Infinity;
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      cap = ms;
      return new AbortController().signal;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const latency = 20000; // every model is slow and overloaded
        if (latency > cap) {
          clock.advance(cap);
          const err = new Error("aborted");
          err.name = "TimeoutError";
          throw err;
        }
        clock.advance(latency);
        return jsonResponse(503, { error: "overloaded" });
      })
    );

    const { response } = await callGemini({}, "key", { totalBudgetMs: 52000 });

    expect(clock.elapsedFrom(start)).toBeLessThanOrEqual(52000);
    // A real upstream status is preferred so the caller can map it properly.
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toBeTruthy();
  });

  it("returns a parseable 504 when every attempt throws", async () => {
    const clock = useVirtualClock();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        clock.advance(5000);
        const err = new Error("timed out");
        err.name = "TimeoutError";
        throw err;
      })
    );

    const { response } = await callGemini({}, "key", { totalBudgetMs: 52000 });

    expect(response.status).toBe(504);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("too long"),
    });
  });

  it("gives up immediately on a non-transient failure", async () => {
    useVirtualClock();
    const fetchMock = vi.fn(async () => jsonResponse(401, { error: "bad key" }));
    vi.stubGlobal("fetch", fetchMock);

    const { response } = await callGemini({}, "key", { totalBudgetMs: 52000 });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no pointless retries
  });

  it("drops a retired model instead of retrying it", async () => {
    const clock = useVirtualClock();
    const calls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const model = modelOf(url);
        calls.push(model);
        clock.advance(500);
        return model === GEMINI_MODELS[0]
          ? jsonResponse(404, { error: "model not found" })
          : jsonResponse(503, { error: "overloaded" });
      })
    );

    await callGemini({}, "key", { totalBudgetMs: 60000 });

    // The 404 model is attempted once in pass 1 and never again.
    expect(calls.filter((m) => m === GEMINI_MODELS[0])).toHaveLength(1);
  });

  it("does not start an attempt it cannot finish", async () => {
    const clock = useVirtualClock();
    const fetchMock = vi.fn(async () => {
      clock.advance(9000);
      return jsonResponse(503, { error: "overloaded" });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Budget only allows one call before the 5s floor stops the loop.
    await callGemini({}, "key", { totalBudgetMs: 12000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
