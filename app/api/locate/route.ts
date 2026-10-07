import { locate } from "@/lib/segment";

/** POST /api/locate { frame, names } -> where each named thing is (Gemini boxes), so Ray's ring lands on the right spot. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { frame?: string; names?: unknown };
    const names = Array.isArray(body.names) ? body.names.map((n) => String(n).slice(0, 60)).filter(Boolean).slice(0, 8) : [];
    if (!body.frame || !names.length || !process.env.GEMINI_API_KEY) return Response.json({ spots: [] });
    return Response.json({ spots: await locate(body.frame, names) });
  } catch (e) {
    console.error("[locate]", e);
    return Response.json({ spots: [] });
  }
}
