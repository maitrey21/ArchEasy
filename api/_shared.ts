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

export interface CallGeminiOptions {
  /** Attempts per model before moving to the next one in GEMINI_MODELS. */
  attemptsPerModel?: number;
  /** Hard ceiling per individual fetch call, in ms. */
  perCallTimeoutMs?: number;
  /**
   * Total wall-clock budget for the whole retry/fallback chain, in ms. Must
   * stay comfortably under the function's `maxDuration` in vercel.json (60s) —
   * otherwise Vercel kills the function itself and returns its own HTML/text
   * crash page instead of JSON, which is unrecoverable on the client side.
   */
  totalBudgetMs?: number;
}

/**
 * Calls Gemini with the given payload, absorbing the transient failures Google
 * returns under load, while staying inside a hard total time budget.
 *
 * Strategy: try each model in GEMINI_MODELS in order. A fast 503/429 failure
 * costs almost nothing, so most of the budget rolls over to whichever model
 * ends up actually generating — each attempt gets whatever time remains,
 * capped by perCallTimeoutMs. A 404 means the model was retired, so we move
 * on immediately. Any other HTTP error is a real failure and returns straight
 * away. If the budget runs out before any model succeeds (including a call
 * that hangs and gets aborted), a synthetic 504 Response is returned instead
 * of letting the caller — or Vercel itself — time out.
 *
 * Returns the response plus the model that actually served it.
 */
export async function callGemini(
  payload: unknown,
  apiKey: string,
  options: CallGeminiOptions = {}
): Promise<{ response: Response; model: string }> {
  const attemptsPerModel = options.attemptsPerModel ?? 1;
  const perCallTimeoutMs = options.perCallTimeoutMs ?? 45000;
  const totalBudgetMs = options.totalBudgetMs ?? 48000;
  const deadline = Date.now() + totalBudgetMs;

  let lastResponse: Response | null = null;
  let lastModel = GEMINI_MODELS[0];
  let sawTimeout = false;

  outer: for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      const remaining = deadline - Date.now();
      // Leave enough headroom to finalise and respond — don't start an
      // attempt that has no realistic chance of finishing in time.
      if (remaining < 4000) break outer;

      lastModel = model;
      const timeoutMs = Math.max(1000, Math.min(perCallTimeoutMs, remaining - 2000));

      try {
        const response = await fetch(GEMINI_ENDPOINT(model, apiKey), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.ok) return { response, model };

        lastResponse = response;

        // Model gone: don't waste another attempt on it.
        if (response.status === 404) {
          console.warn(`Gemini model ${model} returned 404; trying next model`);
          break;
        }

        const overloaded = response.status === 503 || response.status === 429;
        if (!overloaded) return { response, model };

        console.warn(
          `Gemini ${response.status} on ${model} (attempt ${attempt}/${attemptsPerModel}); trying next`
        );
      } catch (err) {
        const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
        sawTimeout ||= timedOut;
        lastResponse = null;
        console.error(
          `Gemini call to ${model} failed:`,
          timedOut ? `aborted after ${timeoutMs}ms` : err
        );
      }
    }
  }

  if (lastResponse) return { response: lastResponse, model: lastModel };

  // Every model failed with no usable HTTP response (pure timeouts/network
  // errors). Return a real Response so callers get clean JSON instead of the
  // request hanging until Vercel's own maxDuration kill kicks in.
  const message = sawTimeout
    ? "The AI took too long to respond. Please try again — a smaller or clearer image can help."
    : "The AI service is temporarily unavailable. Please try again in a moment.";

  return {
    response: new Response(JSON.stringify({ error: message }), {
      status: 504,
      headers: { "Content-Type": "application/json" },
    }),
    model: lastModel,
  };
}

/** Maps a Gemini HTTP failure onto a client-friendly response. */
export function respondGeminiError(res: ApiResponse, status: number, errorText: string) {
  console.error("Gemini API error:", status, errorText);

  if (status === 504) {
    // Synthetic timeout from callGemini's own budget — errorText is already
    // valid JSON with a user-friendly message, so pass it straight through.
    try {
      const parsed = JSON.parse(errorText);
      return res.status(504).json(parsed);
    } catch {
      return res.status(504).json({ error: "The AI took too long to respond. Please try again." });
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
