/**
 * Shared server-only helpers for the /api serverless functions.
 * Nothing in here is ever bundled into the browser.
 */
import { createClient } from "@supabase/supabase-js";

/**
 * Minimal shape of the Vercel serverless handler arguments. Declared locally so
 * the API routes stay typed without pulling in @vercel/node as a dependency.
 */
export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(payload: unknown): ApiResponse;
}

/** Gemini's generateContent response, narrowed to the parts we read. */
export interface GeminiResult {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

/**
 * Model preference order. Google returns 503 UNAVAILABLE ("high demand") on
 * popular models fairly often, so we fall back down this list rather than
 * failing the user's upload. `gemini-flash-latest` is an alias that tracks
 * whichever flash model is current, which also protects against a specific
 * version being retired.
 */
export const GEMINI_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];

/** Kept for callers that just want to report which model is preferred. */
export const GEMINI_MODEL = GEMINI_MODELS[0];

export const GEMINI_ENDPOINT = (model: string, key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

/**
 * Verifies the caller's Supabase session. Returns the user id, or writes an
 * error response and returns null.
 *
 * Runs before any config checks so anonymous callers can neither probe server
 * configuration nor spend the project's Gemini quota.
 */
export async function requireUser(req: ApiRequest, res: ApiResponse): Promise<string | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Supabase env vars are not configured on the server" });
    return null;
  }

  const authHeader = req.headers.authorization || req.headers.Authorization;
  const token =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return null;
  }

  return data.user.id;
}

/**
 * Wall-clock ceiling for these functions, in seconds.
 *
 * MUST stay in sync with `functions[].maxDuration` in vercel.json. If Vercel
 * kills the function first, the platform returns its own HTML/text crash page
 * (FUNCTION_INVOCATION_TIMEOUT) instead of JSON, which the browser cannot
 * interpret — the user just sees "the server took too long or crashed".
 * Everything below is sized so we always answer before that happens.
 *
 * Defaults to 60 to match vercel.json, which every Vercel plan accepts. If you
 * raise maxDuration there (300s is the Hobby maximum once Fluid compute is on,
 * 800s on Pro), set FUNCTION_MAX_DURATION_S to the same value so this budget
 * actually uses the extra room. Keeping the default low is deliberate: a budget
 * larger than the real platform cap would reintroduce the crash page.
 */
export const FUNCTION_MAX_DURATION_S = Number(process.env.FUNCTION_MAX_DURATION_S) || 60;

/** Time reserved for auth, JSON parsing and writing the response. */
const RESPONSE_RESERVE_MS = 8000;

export interface CallGeminiOptions {
  /**
   * How many times to sweep the whole model list. Pass 1 tries each model
   * once; later passes retry models that were merely busy.
   */
  passes?: number;
  /** Hard ceiling for any single HTTP call, in ms. */
  perCallTimeoutMs?: number;
  /** Total wall-clock budget for the whole chain, in ms. */
  totalBudgetMs?: number;
}

/** True when the failure is transient and another model may well succeed. */
const isTransient = (status: number) => status === 503 || status === 429 || status >= 500;

/**
 * Abort signal that fires after `ms`.
 *
 * `AbortSignal.timeout` exists on every runtime we deploy to, but falling back
 * to a manual controller keeps the helper usable anywhere — a missing static
 * would otherwise throw on *every* attempt and fail the whole request.
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("TimeoutError")), ms);
  // Don't hold the process open just for the timer.
  (timer as unknown as { unref?: () => void })?.unref?.();
  return controller.signal;
}

/**
 * Calls Gemini, absorbing the transient failures Google returns under load,
 * while guaranteeing a response inside the function's time budget.
 *
 * Strategy — breadth first, not depth first. A 503 means *that* model is
 * overloaded right now, so the cheapest useful next move is a DIFFERENT model,
 * not the same one again. Each pass therefore tries every model once before
 * any model is retried. This matters because an overloaded Gemini takes
 * 10-20 seconds to answer 503: spending two of those on one model (the old
 * behaviour) burned the entire 60s budget before the healthy third model was
 * ever reached, and Vercel killed the function mid-flight.
 *
 * Also enforced here:
 *  - every call gets AbortSignal.timeout, so one hung request cannot eat the budget
 *  - no attempt starts unless it can plausibly finish before the deadline
 *  - if the budget runs out, a synthetic 504 *JSON* Response is returned, so
 *    the client always gets a readable error instead of a platform crash page
 *
 * Returns the response plus the model that actually served it.
 */
export async function callGemini(
  payload: unknown,
  apiKey: string,
  options: CallGeminiOptions = {}
): Promise<{ response: Response; model: string; elapsedMs: number }> {
  const started = Date.now();
  const passes = options.passes ?? 2;
  const totalBudgetMs =
    options.totalBudgetMs ?? FUNCTION_MAX_DURATION_S * 1000 - RESPONSE_RESERVE_MS;
  const perCallTimeoutMs = options.perCallTimeoutMs ?? totalBudgetMs;
  const deadline = started + totalBudgetMs;

  const body = JSON.stringify(payload);
  let lastResponse: Response | null = null;
  let lastModel = GEMINI_MODELS[0];
  let sawTimeout = false;
  /** Models that returned 404/400-class errors: never worth another attempt. */
  const dead = new Set<string>();

  for (let pass = 1; pass <= passes; pass++) {
    for (const model of GEMINI_MODELS) {
      if (dead.has(model)) continue;

      const remaining = deadline - Date.now();
      // Don't start something that cannot realistically finish in time.
      if (remaining < 5000) {
        console.warn(
          `Gemini budget nearly spent (${remaining}ms left); stopping before ${model} (pass ${pass})`
        );
        pass = passes;
        break;
      }

      lastModel = model;
      const timeoutMs = Math.max(4000, Math.min(perCallTimeoutMs, remaining - 1500));

      try {
        const response = await fetch(GEMINI_ENDPOINT(model, apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: timeoutSignal(timeoutMs),
        });

        if (response.ok) {
          console.log(`Gemini OK on ${model} (pass ${pass}) after ${Date.now() - started}ms`);
          return { response, model, elapsedMs: Date.now() - started };
        }

        lastResponse = response;

        // Retired or rejected model: stop considering it entirely.
        if (response.status === 404 || response.status === 400) {
          console.warn(`Gemini ${response.status} on ${model}; dropping this model`);
          dead.add(model);
          continue;
        }

        // A real, non-transient failure (auth, quota-with-billing, etc.).
        if (!isTransient(response.status)) {
          return { response, model, elapsedMs: Date.now() - started };
        }

        console.warn(
          `Gemini ${response.status} on ${model} (pass ${pass}) after ${Date.now() - started}ms; trying next model`
        );
      } catch (err) {
        const timedOut =
          err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        sawTimeout ||= timedOut;
        console.error(
          `Gemini call to ${model} failed (pass ${pass}):`,
          timedOut ? `aborted after ${timeoutMs}ms` : err
        );
      }
    }
  }

  const elapsedMs = Date.now() - started;

  // Prefer a genuine upstream response so the caller can map the real status.
  if (lastResponse) return { response: lastResponse, model: lastModel, elapsedMs };

  // Nothing but timeouts/network errors. Return real JSON rather than letting
  // the request hang until the platform kills it.
  console.error(`Gemini unreachable after ${elapsedMs}ms (timeout seen: ${sawTimeout})`);
  const message = sawTimeout
    ? "The AI took too long to respond. Please try again — a smaller or clearer drawing helps."
    : "The AI service is temporarily unavailable. Please try again in a moment.";

  return {
    response: new Response(JSON.stringify({ error: message }), {
      status: 504,
      headers: { "Content-Type": "application/json" },
    }),
    model: lastModel,
    elapsedMs,
  };
}

/** Maps a Gemini HTTP failure onto a client-friendly response. */
export function respondGeminiError(res: ApiResponse, status: number, errorText: string) {
  console.error("Gemini API error:", status, errorText);

  if (status === 504) {
    // Synthetic timeout from callGemini's own budget: errorText is already
    // valid JSON carrying a user-facing message, so pass it straight through.
    try {
      return res.status(504).json(JSON.parse(errorText));
    } catch {
      return res.status(504).json({
        error: "The AI took too long to respond. Please try again.",
      });
    }
  }
  if (status === 503) {
    return res.status(503).json({
      error: "Gemini is temporarily overloaded. Please try again in a moment.",
    });
  }
  if (status === 429) {
    return res.status(429).json({ error: "Rate limit exceeded. Please try again in a moment." });
  }
  if (status === 402 || status === 403) {
    return res.status(402).json({
      error: "Gemini API quota exceeded or billing required. Check https://aistudio.google.com/apikey.",
    });
  }
  if (status === 404) {
    return res.status(502).json({
      error: "The configured Gemini model is unavailable. It may have been retired — check the model name.",
    });
  }
  if (status === 400 || status === 401) {
    return res.status(500).json({ error: "Gemini API rejected the request. Check GEMINI_API_KEY." });
  }
  return res.status(502).json({ error: `AI request failed: ${status}` });
}

/** Concatenates Gemini's response parts into a single text blob. */
export function extractText(aiResult: GeminiResult): string {
  return aiResult?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

/**
 * Tolerant JSON extraction. Gemini is asked for raw JSON via responseMimeType,
 * but this still strips code fences / leading prose and repairs a truncated
 * tail so a long response doesn't lose every room.
 */
export function parseAiJson(content: string): unknown {
  let jsonStr = content.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  if (!jsonStr.startsWith("{") && !jsonStr.startsWith("[")) {
    const objStart = jsonStr.search(/[[{]/);
    if (objStart !== -1) jsonStr = jsonStr.substring(objStart);
  }

  try {
    return JSON.parse(jsonStr);
  } catch {
    // Repair attempt: the model hit the token ceiling mid-array. Close the
    // structure after the last complete object so partial results survive.
    const repaired = repairTruncatedJson(jsonStr);
    if (repaired) return JSON.parse(repaired);
    throw new Error("Unparseable AI response");
  }
}

function repairTruncatedJson(input: string): string | null {
  const lastComplete = input.lastIndexOf("}");
  if (lastComplete === -1) return null;

  let candidate = input.slice(0, lastComplete + 1);

  // Balance brackets by walking the string outside of string literals.
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (const ch of candidate) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    if (ch === "}" || ch === "]") stack.pop();
  }

  if (inString) candidate += '"';
  while (stack.length) {
    const open = stack.pop();
    candidate += open === "{" ? "}" : "]";
  }

  return candidate;
}
