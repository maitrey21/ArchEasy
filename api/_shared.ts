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
 * Calls Gemini with the given payload, absorbing the transient failures Google
 * returns under load.
 *
 * Strategy: retry each model a couple of times with backoff for 503/429, then
 * fall through to the next model in GEMINI_MODELS. A 404 means the model was
 * retired, so we move to the next one immediately. Any other error is a real
 * failure and returns straight away.
 *
 * Returns the response plus the model that actually served it.
 */
export async function callGemini(
  payload: unknown,
  apiKey: string,
  attemptsPerModel = 2
): Promise<{ response: Response; model: string }> {
  let lastResponse: Response | null = null;
  let lastModel = GEMINI_MODELS[0];

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      const response = await fetch(GEMINI_ENDPOINT(model, apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) return { response, model };

      lastResponse = response;
      lastModel = model;

      // Model gone: don't waste another attempt on it.
      if (response.status === 404) {
        console.warn(`Gemini model ${model} returned 404; trying next model`);
        break;
      }

      const overloaded = response.status === 503 || response.status === 429;
      if (!overloaded) return { response, model };

      if (attempt < attemptsPerModel) {
        const waitMs = 1200 * attempt;
        console.warn(
          `Gemini ${response.status} on ${model} (attempt ${attempt}/${attemptsPerModel}); retrying in ${waitMs}ms`
        );
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        console.warn(`Gemini ${response.status} on ${model} exhausted; trying next model`);
      }
    }
  }

  return { response: lastResponse!, model: lastModel };
}

/** Maps a Gemini HTTP failure onto a client-friendly response. */
export function respondGeminiError(res: ApiResponse, status: number, errorText: string) {
  console.error("Gemini API error:", status, errorText);

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
