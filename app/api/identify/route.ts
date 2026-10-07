import { identify } from "@/lib/identify";
import { haveCredentials, type Level } from "@/lib/guide";

/** POST /api/identify { frame?, problem?, level } -> what it is, its parts pinned on the image, and where to start. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { frame?: string | null; problem?: string; level?: Level };
    const level: Level = body.level === "advanced" || body.level === "intermediate" ? body.level : "newbie";
    const result = await identify(body.frame ?? null, String(body.problem ?? "").slice(0, 300), level);
    return Response.json({ result, live: haveCredentials() });
  } catch (e) {
    console.error("[identify]", e);
    return Response.json({ error: "Ray couldn't make that out. Try again closer." }, { status: 500 });
  }
}
