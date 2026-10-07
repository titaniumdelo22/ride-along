import { haveCredentials, plan, type Level } from "@/lib/guide";


/** POST /api/plan { task, frame? } -> the job's steps (practice mode without credentials). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { task?: string; frame?: string | null; level?: Level; befores?: unknown };
    const level: Level = body.level === "advanced" || body.level === "intermediate" ? body.level : "newbie";
    // Before photos (putting it back together): up to 8, each a base64 JPEG.
    const befores = Array.isArray(body.befores) ? body.befores.filter((b): b is string => typeof b === "string" && b.length < 600_000).slice(0, 8) : [];
    const p = await plan(String(body.task ?? "").slice(0, 300), body.frame ?? null, level, befores);
    return Response.json({ plan: p, live: haveCredentials() });
  } catch (e) {
    console.error("[plan]", e);
    return Response.json({ error: "The coach couldn't plan that. Try again." }, { status: 500 });
  }
}
