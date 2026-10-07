import { condition } from "@/lib/condition";

/** POST /api/condition { frame } -> is it put back together, and what's still off. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { frame?: string };
    if (!body.frame || body.frame.length > 600_000) return Response.json({ error: "no frame" }, { status: 400 });
    return Response.json(await condition(body.frame));
  } catch (e) {
    console.error("[condition]", e);
    return Response.json({ error: "couldn't check" }, { status: 500 });
  }
}
