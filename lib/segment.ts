import { LABELS, PARTS, byLabel } from "./parts";

/**
 * Gemini vision for the "glasses" overlay.
 *   detectBoxes(frame)  - fast (~1.2 s): every visible part with a bounding box. gemini-3.1-flash-lite.
 *   segmentMasks(frame) - slower: every visible part with a PNG pixel mask. gemini-3.8-flash.
 * Both return normalized 0..1 boxes [x0, y0, x1, y1] and only labels from lib/parts.
 */

export type Part = { label: string; color: string; box: [number, number, number, number]; mask?: string | null };

const KEY = () => process.env.GEMINI_API_KEY || "";
export const BOX_MODEL = process.env.BOX_MODEL || "gemini-3.1-flash-lite";
export const MASK_MODEL = process.env.MASK_MODEL || "gemini-3.8-flash";

const LIST = PARTS.map((p) => `"${p.label}" (${p.hint})`).join("; ");

function thinking(model: string) {
  return model.startsWith("gemini-3") ? { thinkingLevel: process.env.THINK_LEVEL || "low" } : { thinkingBudget: 0 };
}

async function gemini(model: string, frame: string, prompt: string, json: boolean): Promise<string> {
  const body = {
    contents: [{ parts: [{ inline_data: { mime_type: "image/jpeg", data: frame } }, { text: prompt }] }],
    generationConfig: { ...(json ? { responseMimeType: "application/json" } : {}), thinkingConfig: thinking(model), temperature: 0 },
  };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": KEY(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "gemini error");
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") ?? "";
}

type Raw = { box_2d?: number[]; label?: string; mask?: string };

function parse(text: string): Raw[] {
  const s = text.indexOf("[");
  const e = text.lastIndexOf("]");
  if (s < 0 || e < 0) return [];
  try {
    return JSON.parse(text.slice(s, e + 1)) as Raw[];
  } catch {
    return [];
  }
}

function normalize(items: Raw[], withMask: boolean): Part[] {
  const seen = new Set<string>();
  const out: Part[] = [];
  for (const it of items) {
    const def = it.label ? byLabel(it.label) : undefined;
    if (!def || seen.has(def.label)) continue;
    const b = it.box_2d;
    if (!b || b.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(Math.max(v / 1000, 0), 1));
    if (xmax - xmin < 0.01 || ymax - ymin < 0.01) continue;
    seen.add(def.label);
    const mask = withMask && typeof it.mask === "string" && it.mask.startsWith("data:image/png;base64,") ? it.mask : null;
    out.push({ label: def.label, color: def.color, box: [xmin, ymin, xmax, ymax], mask });
  }
  return out;
}

export async function detectBoxes(frame: string): Promise<Part[]> {
  const prompt = `Live camera view of a Clover D1 water cooler with its back cover removed. Detect every part from this list that is clearly visible: ${LIST}.
Return a JSON list of {"box_2d":[ymin,xmin,ymax,xmax] on a 0-1000 scale, "label": exactly one label from the list}.
Tight boxes around the part itself. Each label at most once. Skip anything not clearly visible. Never label paper, tools, walls or other objects.`;
  return normalize(parse(await gemini(BOX_MODEL, frame, prompt, true)), false);
}

export async function segmentMasks(frame: string): Promise<Part[]> {
  const prompt = `This is a live camera view of a water cooler (Clover D1). Give segmentation masks for every part from this list that is clearly visible: ${LIST}.
Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d" ([ymin,xmin,ymax,xmax], 0-1000), the segmentation mask in key "mask", and the text label in the key "label". Use ONLY labels from the list: ${LABELS.join(", ")}. Each label at most once. Skip parts that are not visible.`;
  return normalize(parse(await gemini(MASK_MODEL, frame, prompt, false)), true);
}

/**
 * Find named things in a frame (names chosen by the coach, e.g. "data label"), for pinning exactly where they are.
 * Returns the box center for each name Gemini can see.
 */
export async function locate(frame: string, names: string[]): Promise<{ label: string; x: number; y: number }[]> {
  const prompt = `Find these in the image if they are visible: ${names.map((n) => `"${n}"`).join(", ")}.
JSON list of {"box_2d":[ymin,xmin,ymax,xmax] 0-1000, "label"} using exactly those names. Tight boxes. Skip what is not visible.`;
  const out: { label: string; x: number; y: number }[] = [];
  for (const it of parse(await gemini(BOX_MODEL, frame, prompt, true))) {
    const b = it.box_2d;
    if (!it.label || !b || b.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(Math.max(v / 1000, 0), 1));
    out.push({ label: it.label, x: (xmin + xmax) / 2, y: (ymin + ymax) / 2 });
  }
  return out;
}
