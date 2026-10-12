// Temporary diagnostic: what does the Gemini key actually allow?
// Prints status codes and messages only - never the key or the request URL.
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
if (!key) {
  console.log("GEMINI_API_KEY missing from .env");
  process.exit(1);
}
console.log(`key: length=${key.length} prefix=${key.slice(0, 4)}… quoted=${/^["']/.test(env.GEMINI_API_KEY)}`);

// 1. Which models does this key actually have access to?
const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=200`);
console.log(`\nListModels -> HTTP ${listRes.status}`);
const listBody = await listRes.json().catch(() => null);
if (!listRes.ok) {
  console.log("  error:", JSON.stringify(listBody?.error?.message ?? listBody).slice(0, 400));
} else {
  const usable = (listBody.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace("models/", ""));
  console.log(`  ${usable.length} models support generateContent`);
  console.log("  flash/pro candidates:");
  usable.filter((n) => /flash|pro/.test(n) && !/vision|embed|tts|image|live|native/.test(n))
    .forEach((n) => console.log("   -", n));
}

// 2. What happens for each model the code tries, plus likely correct names?
const CODE_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"];
const ALSO_TRY = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-pro", "gemini-1.5-flash"];

console.log("\ngenerateContent probe (tiny payload):");
for (const model of [...CODE_MODELS, ...ALSO_TRY]) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "Reply with the single word OK." }] }] }),
    }
  );
  const body = await res.json().catch(() => null);
  const msg = res.ok
    ? JSON.stringify(body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").slice(0, 40)
    : `${body?.error?.status ?? ""} ${body?.error?.message ?? ""}`.trim().slice(0, 260);
  const tag = CODE_MODELS.includes(model) ? "[in code]" : "[extra]  ";
  console.log(`  ${tag} ${model.padEnd(22)} HTTP ${res.status}  ${msg}`);
}
