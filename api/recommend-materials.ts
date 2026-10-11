/**
 * Vercel Serverless Function - AI material recommendations.
 *
 * Takes the rooms detected for a floor and returns, per room and per element
 * (floor / wall / ceiling): the detected finish, a recommended finish, the
 * reasoning behind it, and Budget / Standard / Premium alternatives.
 *
 * Runs server-side only, so GEMINI_API_KEY never reaches the browser.
 * Recommendations are advisory: the architect accepts, rejects or edits them in
 * the UI, and nothing is written into the Schedule of Finishes automatically.
 */
import {
  requireUser,
  respondGeminiError,
  extractText,
  parseAiJson,
  callGemini,
  type ApiRequest,
  type ApiResponse,
  type GeminiResult,
} from "./_shared.js";

/** Room fields this endpoint reasons about. */
interface RoomInput {
  name?: string;
  room_type?: string;
  space_tag?: string;
  area?: number | null;
  floor_finish?: string;
  wall_finish?: string;
  ceiling_finish?: string;
  dado?: string;
  skirting?: string;
}

interface RecommendBody {
  rooms?: RoomInput[];
  projectName?: string;
  floorName?: string;
}

interface RawAlternative {
  tier?: unknown;
  material?: unknown;
  make?: unknown;
  finish?: unknown;
  approx_rate?: unknown;
  rationale?: unknown;
}

interface RawRecommendation {
  room_index?: unknown;
  room_name?: unknown;
  element?: unknown;
  detected_finish?: unknown;
  recommended_finish?: unknown;
  rationale?: unknown;
  durability?: unknown;
  maintenance?: unknown;
  moisture_resistance?: unknown;
  slip_resistance?: unknown;
  cost_band?: unknown;
  alternatives?: unknown;
}

const SYSTEM_PROMPT = `You are a specification consultant advising an architect on interior finish selection for an Indian construction project. You review finishes that were read off a drawing and recommend what should actually be specified.

For EVERY room you are given, produce three recommendation objects - one each for element "floor", "wall" and "ceiling".

Judge every recommendation against these criteria, and reference the ones that actually drive the decision in your rationale:
- Suitability for the room's type and real usage pattern
- Durability under expected foot traffic and wear
- Maintenance burden and ease of cleaning
- Moisture and water exposure (wet vs dry areas)
- Slip resistance where floors get wet (bathrooms, kitchens, balconies, entrances, ramps)
- Acoustic and thermal behaviour where it matters (offices, bedrooms, meeting rooms)
- Fire and safety compliance for escape routes, staircases and service rooms
- Cost sensibleness - do not over-specify a store room or under-specify a lobby

Rules:
- "detected_finish" must echo the finish you were given for that element. If none was supplied, use "Not specified".
- "recommended_finish" is your single best specification for that element. If the detected finish is already correct, repeat it and say so in the rationale.
- "rationale" must be specific to that room. Explain the driving factor (moisture, traffic, slip risk, acoustics, cost). Never generic filler.
- Provide EXACTLY three alternatives with tier "Budget", "Standard" and "Premium", in that order. Each needs a real material, a plausible Indian-market make/brand, a finish descriptor, an approximate rate with unit (e.g. "Rs 45-60 /sqft"), and a one-line rationale covering its trade-off.
- Rate the qualitative fields using only: Low, Medium, High, Very High.
- "cost_band" describes the recommended_finish: Economy, Mid-range, or Premium.
- Be concise. No markdown, no code fences. Raw JSON only.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          room_index: {
            type: "integer",
            description: "Zero-based index of the room from the supplied list.",
          },
          room_name: { type: "string" },
          element: { type: "string", enum: ["floor", "wall", "ceiling"] },
          detected_finish: { type: "string" },
          recommended_finish: { type: "string" },
          rationale: { type: "string" },
          durability: { type: "string", enum: ["Low", "Medium", "High", "Very High"] },
          maintenance: { type: "string", enum: ["Low", "Medium", "High", "Very High"] },
          moisture_resistance: { type: "string", enum: ["Low", "Medium", "High", "Very High"] },
          slip_resistance: { type: "string", enum: ["Low", "Medium", "High", "Very High"] },
          cost_band: { type: "string", enum: ["Economy", "Mid-range", "Premium"] },
          alternatives: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tier: { type: "string", enum: ["Budget", "Standard", "Premium"] },
                material: { type: "string" },
                make: { type: "string" },
                finish: { type: "string" },
                approx_rate: { type: "string" },
                rationale: { type: "string" },
              },
              required: ["tier", "material", "make", "finish", "approx_rate", "rationale"],
              propertyOrdering: ["tier", "material", "make", "finish", "approx_rate", "rationale"],
            },
          },
        },
        required: [
          "room_index", "room_name", "element", "detected_finish",
          "recommended_finish", "rationale", "durability", "maintenance",
          "moisture_resistance", "slip_resistance", "cost_band", "alternatives",
        ],
        propertyOrdering: [
          "room_index", "room_name", "element", "detected_finish",
          "recommended_finish", "rationale", "durability", "maintenance",
          "moisture_resistance", "slip_resistance", "cost_band", "alternatives",
        ],
      },
    },
  },
  required: ["recommendations"],
};

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

    const body: RecommendBody =
      typeof req.body === "string" ? JSON.parse(req.body) : ((req.body ?? {}) as RecommendBody);
    const { rooms, projectName, floorName } = body;

    if (!Array.isArray(rooms) || rooms.length === 0) {
      return res.status(400).json({ error: "rooms array is required" });
    }

    // Cap the batch so a huge floor can't blow the token ceiling. The client
    // chunks larger floors into multiple calls.
    if (rooms.length > 40) {
      return res.status(400).json({ error: "Too many rooms in one request (max 40). Split into batches." });
    }

    // Send only what the model needs to reason about, keyed by index so the
    // response can be mapped back to real room ids on the client.
    const roomDigest = rooms.map((r, i) => ({
      index: i,
      name: r.name ?? "Unnamed Room",
      room_type: r.room_type ?? "general",
      space_tag: r.space_tag ?? "",
      area: r.area ?? null,
      detected_floor_finish: r.floor_finish ?? "",
      detected_wall_finish: r.wall_finish ?? "",
      detected_ceiling_finish: r.ceiling_finish ?? "",
      detected_dado: r.dado ?? "",
      detected_skirting: r.skirting ?? "",
    }));

    const userText = [
      projectName ? `Project: ${projectName}` : "",
      floorName ? `Floor: ${floorName}` : "",
      "",
      "Rooms to review (JSON):",
      JSON.stringify(roomDigest, null, 1),
      "",
      `Return exactly ${rooms.length * 3} recommendation objects: one per room for element "floor", one for "wall" and one for "ceiling". Use room_index to reference the room by its "index" above.`,
    ]
      .filter(Boolean)
      .join("\n");

    console.log("Recommending materials for", rooms.length, "rooms; floor:", floorName, "user:", userId);

    const { response, model, elapsedMs } = await callGemini(
      {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.2,
          topP: 0.95,
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingBudget: 4096 },
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      },
      GEMINI_API_KEY,
      // Text-only and lighter reasoning than detection, so individual calls
      // are quick; cap them tightly to leave room for model fail-over.
      { perCallTimeoutMs: 20000 }
    );

    if (!response.ok) {
      return respondGeminiError(res, response.status, await response.text());
    }

    const aiResult = (await response.json()) as GeminiResult;
    const content = extractText(aiResult);
    const finishReason = aiResult?.candidates?.[0]?.finishReason;
    console.log(
      "Recommendation response length:", content.length, "model:", model,
      "finishReason:", finishReason, "geminiMs:", elapsedMs
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = parseAiJson(content) as Record<string, unknown>;
    } catch (parseErr) {
      console.error("Failed to parse recommendations:", parseErr, "Head:", content.substring(0, 800));
      return res.status(502).json({ error: "AI returned an unreadable recommendation response. Please retry." });
    }

    const raw: RawRecommendation[] = Array.isArray(parsed.recommendations)
      ? (parsed.recommendations as RawRecommendation[])
      : [];

    // Normalise and drop anything that can't be tied back to a supplied room.
    const validElements = new Set(["floor", "wall", "ceiling"]);
    const recommendations = raw
      .filter((r) => {
        const idx = Number(r.room_index);
        return (
          Number.isInteger(idx) &&
          idx >= 0 &&
          idx < rooms.length &&
          validElements.has(String(r.element))
        );
      })
      .map((r) => ({
        room_index: Number(r.room_index),
        room_name: String(r.room_name ?? rooms[Number(r.room_index)]?.name ?? ""),
        element: String(r.element),
        detected_finish: String(r.detected_finish ?? ""),
        recommended_finish: String(r.recommended_finish ?? ""),
        rationale: String(r.rationale ?? ""),
        durability: String(r.durability ?? ""),
        maintenance: String(r.maintenance ?? ""),
        moisture_resistance: String(r.moisture_resistance ?? ""),
        slip_resistance: String(r.slip_resistance ?? ""),
        cost_band: String(r.cost_band ?? ""),
        alternatives: Array.isArray(r.alternatives)
          ? (r.alternatives as RawAlternative[]).slice(0, 3).map((a) => ({
              tier: String(a.tier ?? ""),
              material: String(a.material ?? ""),
              make: String(a.make ?? ""),
              finish: String(a.finish ?? ""),
              approx_rate: String(a.approx_rate ?? ""),
              rationale: String(a.rationale ?? ""),
            }))
          : [],
      }));

    const expected = rooms.length * 3;

    return res.status(200).json({
      success: true,
      model,
      expected_count: expected,
      returned_count: recommendations.length,
      incomplete: recommendations.length < expected,
      finish_reason: finishReason ?? null,
      recommendations,
    });
  } catch (e) {
    console.error("recommend-materials error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Unknown error" });
  }
}
