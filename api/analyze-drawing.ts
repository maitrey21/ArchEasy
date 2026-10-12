/**
 * Vercel Serverless Function - runs on the SERVER, never in the browser.
 *
 * `process.env.GEMINI_API_KEY` has no VITE_ prefix, so Vite never inlines it
 * into the client bundle. The browser only ever talks to /api/analyze-drawing.
 *
 * Required env vars (Vercel -> Project -> Settings -> Environment Variables):
 *   GEMINI_API_KEY                 (secret, https://aistudio.google.com/apikey)
 *   VITE_SUPABASE_URL              (reused for JWT verification)
 *   VITE_SUPABASE_PUBLISHABLE_KEY  (anon key)
 */
import {
  requireUser,
  respondGeminiError,
  extractText,
  parseAiJson,
  callGemini,
  heavyCallTimeoutMs,
  type ApiRequest,
  type ApiResponse,
  type GeminiResult,
} from "./_shared.js";

/**
 * Detection prompt.
 *
 * The recall strategy is deliberate: the model must first transcribe EVERY text
 * label it can see into `label_inventory`, then derive `rooms` from that
 * inventory, then reconcile the two counts. Enumerating before summarising is
 * what stops the model from silently collapsing or skipping small spaces, which
 * was the main source of missed rooms.
 */
const SYSTEM_PROMPT = `You are a senior architectural drawing surveyor producing a Schedule of Finishes. Your single most important quality metric is RECALL: every labelled space in the drawing must be accounted for. A missed room is a critical failure.

=========================
PHASE 1 - LABEL TRANSCRIPTION (do this first)
=========================
Sweep the drawing systematically and transcribe EVERY piece of text that names or tags a space.
- Work in a strict grid: divide the sheet into a 4x4 mental grid. Scan cell by cell, left-to-right, top-to-bottom. Do not skip a cell.
- Then scan the drawing's edges and corners separately: small service spaces hide there.
- Zoom your attention into dense/cluttered areas and re-read overlapping text.
- Transcribe the label EXACTLY as written, including numbers and suffixes (e.g. "TOILET-2", "BEDROOM 03", "AHU RM", "W.C.", "STORE (L)").
- Include room tags/numbers even when they appear separately from the name (e.g. "101", "G-04", "R3").
- Record every label into "label_inventory". This is a transcription task, NOT a filtering task. Do not judge relevance yet.

Commonly missed items you MUST actively hunt for:
staircase / stair / steps, lift / elevator / lift lobby, shafts (plumbing, electrical, service, duct, garbage), ducts, AHU / HVAC rooms, electrical / meter / DB / panel rooms, pump room, water tank / OHT / UGT, pantry, servery, janitor / housekeeping, store / storage, utility, wash area, dry balcony, balcony / terrace / deck, sit-out, foyer / entrance lobby, corridor / passage / circulation (each labelled segment separately), vestibule, W.C. / toilet / powder room / bath, dress / walk-in wardrobe, loft, niche, void / double-height, ramp, parking bays, security cabin, ACP / server / IT room, fire exit, refuge area.

=========================
PHASE 2 - ROOM EXTRACTION
=========================
Convert the inventory into "rooms". Rules:
- EVERY label in label_inventory MUST either become a room in "rooms", OR appear in "undetected_spaces" with a specific reason. Nothing may vanish silently.
- NEVER merge or deduplicate numbered/repeated spaces. "TOILET-1" and "TOILET-2" are two separate rooms. Three identical "BEDROOM" labels are three rooms.
- Do not invent rooms that have no label or visible boundary.
- If a space is clearly enclosed but its label is illegible, still emit a room named "Unlabelled Space (<location>)" and note it in undetected_spaces.
- Preserve the drawing's own naming. Do not rename "AHU RM" to "Air Handling Unit Room"; keep the source wording, tidied only for capitalisation.
- Give each room a "bbox" as normalised integers [ymin, xmin, ymax, xmax] on a 0-1000 scale covering that room's area on the sheet. This anchors your reading spatially and is required.

=========================
PHASE 3 - RECONCILIATION (self-check before answering)
=========================
- Count label_inventory. Count rooms. Count undetected_spaces.
- Set "label_count" and "room_count" honestly.
- If room_count is lower than the number of space labels, go back to Phase 1 and find what you dropped. Do not submit an under-counted result.
- Set "sweep_complete" to true only if you genuinely scanned all 16 grid cells plus edges.

=========================
FINISH RECOMMENDATIONS
=========================
For every room, fill the finish fields using these guidelines:
- Bathrooms / toilets / W.C. / wash: anti-skid ceramic or vitrified tiles, MR grade gypsum ceiling, tiled dado to lintel height
- Kitchen / pantry / servery: anti-skid ceramic tiles, easy-clean tiled dado, washable ceiling paint
- Offices / cabins / meeting: carpet tiles or engineered wood, acoustic mineral fibre ceiling
- Lobby / foyer / corridor / passage: homogenous vitrified tiles or granite, glossy finish, gypsum ceiling
- Utility / electrical / AHU / pump / shaft: epoxy or IPS flooring, industrial grade, exposed or cement paint ceiling
- Bedrooms: vitrified tiles or laminate/engineered wood, POP punning with emulsion
- Living / dining: vitrified tiles or marble, gypsum ceiling with cove lighting
- Staircase: granite or kota stone treads, MS railing, cement paint soffit
- Balcony / terrace / sit-out / dry balcony: anti-skid outdoor-grade tiles, weather-resistant exterior paint
- Parking / ramp: heavy-duty IPS or paver blocks, anti-skid, exposed ceiling
- Store / storage / janitor: ceramic tiles, durable low-maintenance finish

HARD CONSTRAINTS
- Leave "flooring_size" and "ceiling_size" as empty strings. Always.
- "remark" is REQUIRED for every room and must explain WHY those materials suit that space (reference moisture, slip risk, traffic, durability or maintenance).
- Use the exact floor level label supplied in the user message for every room's "floor_level".
- Return raw JSON only. No markdown, no code fences, no commentary.`;

/** OpenAPI-subset schema. Forces every field to exist on every room. */
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sweep_complete: { type: "boolean" },
    drawing_type: {
      type: "string",
      enum: ["floor_plan", "elevation", "section", "detail", "unknown"],
    },
    summary: { type: "string" },
    label_count: { type: "integer" },
    room_count: { type: "integer" },
    label_inventory: {
      type: "array",
      description: "Every space-naming text string transcribed from the drawing.",
      items: { type: "string" },
    },
    undetected_spaces: {
      type: "array",
      description: "Labels that could not be turned into rooms, each with a reason.",
      items: { type: "string" },
    },
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          floor_level: { type: "string" },
          space_tag: { type: "string" },
          room_type: {
            type: "string",
            enum: [
              "bedroom", "bathroom", "kitchen", "living", "dining", "hallway",
              "utility", "office", "storage", "balcony", "garage", "lobby",
              "staircase", "parking", "service", "general",
            ],
          },
          bbox: {
            type: "array",
            description: "Normalised [ymin, xmin, ymax, xmax] on a 0-1000 scale.",
            items: { type: "integer" },
          },
          area: { type: "number", nullable: true },
          ceiling_height: { type: "number", nullable: true },
          floor_finish: { type: "string" },
          flooring_size: { type: "string" },
          flooring_finish: { type: "string" },
          flooring_code: { type: "string" },
          flooring_make: { type: "string" },
          flooring_rate: { type: "string" },
          skirting: { type: "string" },
          skirting_code: { type: "string" },
          skirting_make: { type: "string" },
          skirting_rate: { type: "string" },
          ceiling_finish: { type: "string" },
          ceiling_material_2: { type: "string" },
          ceiling_size: { type: "string" },
          ceiling_code: { type: "string" },
          ceiling_make: { type: "string" },
          ceiling_rate: { type: "string" },
          wall_finish: { type: "string" },
          paint_color: { type: "string" },
          dado: { type: "string" },
          remark: { type: "string" },
        },
        required: [
          "name", "floor_level", "space_tag", "room_type", "bbox",
          "floor_finish", "flooring_finish", "skirting",
          "ceiling_finish", "wall_finish", "remark",
        ],
        propertyOrdering: [
          "name", "space_tag", "floor_level", "room_type", "bbox", "area",
          "ceiling_height", "floor_finish", "flooring_size", "flooring_finish",
          "flooring_code", "flooring_make", "flooring_rate", "skirting",
          "skirting_code", "skirting_make", "skirting_rate", "ceiling_finish",
          "ceiling_material_2", "ceiling_size", "ceiling_code", "ceiling_make",
          "ceiling_rate", "wall_finish", "paint_color", "dado", "remark",
        ],
      },
    },
  },
  required: ["rooms", "label_inventory", "undetected_spaces", "drawing_type", "summary"],
  propertyOrdering: [
    "sweep_complete", "drawing_type", "summary", "label_count", "room_count",
    "label_inventory", "undetected_spaces", "rooms",
  ],
};

interface AnalyzeBody {
  imageBase64?: string;
  fileName?: string;
  mimeType?: string;
  floorName?: string;
}

interface DetectedRoomPayload {
  name?: string;
  space_tag?: string;
  [key: string]: unknown;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userId = await requireUser(req, res);
    if (!userId) return;

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
    }

    const body: AnalyzeBody =
      typeof req.body === "string" ? JSON.parse(req.body) : ((req.body ?? {}) as AnalyzeBody);
    const { imageBase64, fileName, mimeType, floorName } = body;

    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    // imageBase64 arrives as a data URL ("data:image/png;base64,AAAA..."), but
    // Gemini's inlineData wants the raw payload and mimeType separately.
    const match = /^data:([^;]+);base64,(.*)$/s.exec(imageBase64);
    const inlineMimeType = match?.[1] || mimeType || "image/png";
    const base64Data = match?.[2] || imageBase64;

    const floorLabel = typeof floorName === "string" && floorName.trim() ? floorName.trim() : "";

    console.log("Analyzing drawing:", fileName, "mime:", inlineMimeType, "floor:", floorLabel, "user:", userId);

    const userText = [
      `Analyze this architectural drawing: "${fileName}".`,
      floorLabel
        ? `This sheet is the "${floorLabel}". Set every room's "floor_level" to exactly "${floorLabel}".`
        : `Set each room's "floor_level" from whatever level label is visible on the sheet.`,
      "",
      "Follow all three phases. Transcribe every space label into label_inventory FIRST, then derive rooms from it, then reconcile the counts. Every label must end up either in rooms or in undetected_spaces with a reason.",
      "Include a bbox for every room. Leave flooring_size and ceiling_size empty. Every room needs a remark explaining the material choice.",
    ].join("\n");

    const { response, model, elapsedMs } = await callGemini(
      {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: inlineMimeType, data: base64Data } },
              { text: userText },
            ],
          },
        ],
        generationConfig: {
          // Near-deterministic: detection should not vary run to run.
          temperature: 0.05,
          topP: 0.95,
          // Reasoning tokens count against maxOutputTokens on thinking models,
          // so the ceiling has to cover the sweep AND a long room array.
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingBudget: 8192 },
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      },
      GEMINI_API_KEY,
      // Detection is the slowest call in the app: a dense sheet can take 30s+
      // on its own. The cap scales with the function budget: 24s on Vercel's
      // 60s limit (leaving room to fail over), up to 120s when more is allowed.
      { perCallTimeoutMs: heavyCallTimeoutMs() }
    );

    if (!response.ok) {
      return respondGeminiError(res, response.status, await response.text());
    }

    const aiResult = (await response.json()) as GeminiResult;
    const content = extractText(aiResult);
    const finishReason = aiResult?.candidates?.[0]?.finishReason;
    console.log(
      "AI response length:", content.length, "model:", model,
      "finishReason:", finishReason, "geminiMs:", elapsedMs
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = parseAiJson(content) as Record<string, unknown>;
    } catch (parseErr) {
      console.error("Failed to parse AI response:", parseErr, "Content head:", content.substring(0, 1000));
      parsed = {
        rooms: [],
        label_inventory: [],
        undetected_spaces: ["AI response could not be parsed. Please re-upload the drawing."],
        drawing_type: "unknown",
        summary: "Parse error",
      };
    }

    const rooms: DetectedRoomPayload[] = Array.isArray(parsed.rooms)
      ? (parsed.rooms as DetectedRoomPayload[])
      : [];
    const labelInventory: string[] = Array.isArray(parsed.label_inventory)
      ? (parsed.label_inventory as string[])
      : [];
    const undetectedSpaces: string[] = Array.isArray(parsed.undetected_spaces)
      ? (parsed.undetected_spaces as string[])
      : [];

    // Server-side reconciliation. The model self-checks, but we verify rather
    // than trust: any label with no matching room becomes an explicit warning
    // for the architect instead of a silent omission.
    const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const roomKeys = new Set(
      rooms.flatMap((r) => [normalise(String(r.name ?? "")), normalise(String(r.space_tag ?? ""))])
    );
    const unmatchedLabels = labelInventory.filter((label) => {
      const key = normalise(label);
      if (!key) return false;
      if (roomKeys.has(key)) return false;
      // Also treat a label as matched if it is contained in any room name/tag.
      return ![...roomKeys].some((rk) => rk && (rk.includes(key) || key.includes(rk)));
    });

    const feedbackLines: string[] = [];

    if (rooms.length === 0) {
      feedbackLines.push(
        "No rooms could be detected from this drawing. Try a higher-resolution image or a clearer floor plan."
      );
    } else {
      feedbackLines.push(`Detected ${rooms.length} space${rooms.length === 1 ? "" : "s"} from ${labelInventory.length} label${labelInventory.length === 1 ? "" : "s"} read off the sheet.`);
    }

    if (undetectedSpaces.length > 0) {
      feedbackLines.push("Spaces the AI flagged as uncertain:");
      undetectedSpaces.forEach((s, i) => feedbackLines.push(`${i + 1}. ${s}`));
    }

    if (unmatchedLabels.length > 0) {
      feedbackLines.push(
        `Labels read from the drawing with no matching row in the schedule (please verify): ${unmatchedLabels.join(", ")}.`
      );
    }

    if (finishReason && finishReason !== "STOP") {
      feedbackLines.push(
        `The AI response ended early (${finishReason}). Very dense drawings may need to be split per floor or per zone for complete coverage.`
      );
    }

    if (undetectedSpaces.length === 0 && unmatchedLabels.length === 0 && rooms.length > 0) {
      feedbackLines.push("Every label read from the drawing was matched to a room in the schedule.");
    }

    return res.status(200).json({
      success: true,
      model,
      rooms,
      drawing_type: parsed.drawing_type ?? "unknown",
      summary: parsed.summary ?? "",
      label_count: parsed.label_count ?? labelInventory.length,
      label_inventory: labelInventory,
      undetected_spaces: undetectedSpaces,
      unmatched_labels: unmatchedLabels,
      sweep_complete: parsed.sweep_complete ?? null,
      finish_reason: finishReason ?? null,
      analysis_feedback: feedbackLines.join("\n"),
    });
  } catch (e) {
    console.error("analyze-drawing error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Unknown error" });
  }
}
