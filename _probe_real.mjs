// Temporary diagnostic: replicate the real analyze-drawing call and report
// token usage + Google's exact error. Never prints the key or request URL.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^\s*[A-Za-z_]\w*\s*=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const key = env.GEMINI_API_KEY;

// Pull the real system prompt out of the handler (single template literal).
const src = readFileSync("api/analyze-drawing.ts", "utf8");
const SYSTEM_PROMPT = src.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
console.log("system prompt chars:", SYSTEM_PROMPT.length);

const img = readFileSync("src/assets/hero-blueprint.jpg");
console.log("image bytes:", img.length, "-> base64 chars:", img.toString("base64").length);

const payload = {
  systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
  contents: [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: img.toString("base64") } },
        { text: 'Analyze this architectural drawing: "hero-blueprint.jpg".\nThis sheet is the "Ground Floor".' },
      ],
    },
  ],
  generationConfig: {
    temperature: 0.05,
    topP: 0.95,
    maxOutputTokens: 32768,
    thinkingConfig: { thinkingBudget: 8192 },
    responseMimeType: "application/json",
  },
};

const model = process.argv[2] ?? "gemini-3.6-flash";

// 1. How big is the input?
const ct = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:countTokens?key=${key}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: payload.contents }),
  }
);
const ctBody = await ct.json().catch(() => null);
console.log(`countTokens -> HTTP ${ct.status}`, JSON.stringify(ctBody).slice(0, 200));

// 2. The real call.
console.log(`\ngenerateContent on ${model} ...`);
const t0 = Date.now();
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }
);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`-> HTTP ${res.status} in ${secs}s`);
console.log("retry-after:", res.headers.get("retry-after"));

const body = await res.json().catch(() => null);
if (!res.ok) {
  console.log("error status :", body?.error?.status);
  console.log("error message:", body?.error?.message);
  const details = body?.error?.details;
  if (details) console.log("error details:", JSON.stringify(details, null, 2).slice(0, 2000));
} else {
  console.log("usage:", JSON.stringify(body.usageMetadata));
  console.log("finishReason:", body.candidates?.[0]?.finishReason);
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  console.log("output chars:", text.length);
  console.log("head:", text.slice(0, 220));
}
