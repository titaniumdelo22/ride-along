import { identify, type IdentifyMode } from "@/lib/identify";
import { haveCredentials, type Level } from "@/lib/guide";

/** POST /api/identify { frame?, problem?, level } -> what it is, its parts pinned on the image, and where to start. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { frame?: string | null; problem?: string; level?: Level; mode?: IdentifyMode; befores?: unknown };
    const level: Level = body.level === "advanced" || body.level === "intermediate" ? body.level : "newbie";
    const mode: IdentifyMode = body.mode === "parts" ? "parts" : "what";
    const befores = Array.isArray(body.befores) ? body.befores.filter((b): b is string => typeof b === "string" && b.length < 600_000).slice(0, 8) : [];
    const result = await identify(body.frame ?? null, String(body.problem ?? "").slice(0, 300), level, mode, befores);
    return Response.json({ result, live: haveCredentials() });
  } catch (e) {
    console.error("[identify]", e);
    return Response.json({ error: "Ray couldn't make that out. Try again closer." }, { status: 500 });
  }
}
