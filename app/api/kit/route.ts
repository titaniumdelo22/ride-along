import { haveCredentials, kit, type Level } from "@/lib/guide";

/** POST /api/kit { task, frame?, level } -> the item and the gear to grab, fast (the steps come from /api/plan in parallel). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { task?: string; frame?: string | null; level?: Level };
    const level: Level = body.level === "advanced" || body.level === "intermediate" ? body.level : "newbie";
    const k = await kit(String(body.task ?? "").slice(0, 300), body.frame ?? null, level);
    return Response.json({ kit: k, live: haveCredentials() });
  } catch (e) {
    console.error("[kit]", e);
    return Response.json({ error: "The coach couldn't size that up. Try again." }, { status: 500 });
  }
}
