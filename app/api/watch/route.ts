import { watch, type WatchInput } from "@/lib/guide";


/** POST /api/watch { frame, task, plan, current, teach, recent, userSaid } -> what the coach sees, says and points at. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as WatchInput;
    const w = await watch({
      level: body.level === "advanced" || body.level === "intermediate" ? body.level : "newbie",
      frame: body.frame ?? null,
      task: String(body.task ?? "").slice(0, 300),
      plan: body.plan,
      current: Math.max(0, Math.min(Number(body.current) || 0, body.plan.steps.length - 1)),
      teach: !!body.teach,
      recent: Array.isArray(body.recent) ? body.recent.slice(-4).map(String) : [],
      talk: Array.isArray(body.talk)
        ? body.talk.slice(-12).map((t) => ({ who: t?.who === "you" ? ("you" as const) : ("ray" as const), text: String(t?.text ?? "").slice(0, 300) }))
        : [],
      userSaid: body.userSaid ? String(body.userSaid).slice(0, 400) : null,
      ref: typeof body.ref === "string" && body.ref.length < 600_000 ? body.ref : null,
      surprises: Array.isArray(body.surprises) ? body.surprises.slice(-6).map((x) => String(x).slice(0, 120)) : [],
    });
    return Response.json(w);
  } catch (e) {
    console.error("[watch]", e);
    return Response.json({ error: "The coach lost the picture for a second." }, { status: 500 });
  }
}
