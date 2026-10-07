import { detectBoxes, segmentMasks } from "@/lib/segment";

/** POST /api/parts { frame, mode: "boxes" | "masks" } -> { parts: [{label,color,box,mask?}], ms } */
export async function POST(req: Request) {
  const t0 = Date.now();
  try {
    const body = (await req.json()) as { frame?: string; mode?: string };
    if (!body.frame) return Response.json({ error: "no frame" }, { status: 400 });
    if (!process.env.GEMINI_API_KEY) return Response.json({ error: "GEMINI_API_KEY is not set" }, { status: 500 });
    const parts = body.mode === "masks" ? await segmentMasks(body.frame) : await detectBoxes(body.frame);
    return Response.json({ parts, ms: Date.now() - t0 });
  } catch (e) {
    console.error("[parts]", e);
    return Response.json({ error: String((e as Error).message || e), ms: Date.now() - t0 }, { status: 500 });
  }
}
