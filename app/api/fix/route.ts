import { planFix, watchFix, replanFix, intakeNext, askRay, type WatchContext, type Anomaly } from "@/lib/fix";

/**
 * POST /api/fix
 *   { mode: "plan", problem, frame? }                                  -> FixPlan
 *   { mode: "watch", frame, problem, plan, current, history, userSaid } -> FixWatch (may rewrite remaining steps)
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { mode: string; problem?: string; frame?: string | null; photos?: string[]; notes?: string[]; asked?: string[]; done?: string[]; question?: string; tab?: string; inView?: string[]; anomalies?: Anomaly[] } & Partial<WatchContext>;
    if (b.mode === "ask") return Response.json({ say: await askRay(String(b.question ?? "").slice(0, 400), b.frame ?? null, { tab: String(b.tab ?? "scan"), problem: b.problem, plan: b.plan ?? null, current: Number(b.current) || 0, inView: Array.isArray(b.inView) ? b.inView.map(String) : [] }) });
    if (b.mode === "intake") return Response.json(await intakeNext(String(b.problem ?? "").slice(0, 400), Array.isArray(b.photos) ? b.photos.slice(0, 5) : [], 4, Array.isArray(b.asked) ? b.asked.map(String) : []));
    if (b.mode === "plan") return Response.json(await planFix(String(b.problem ?? "").slice(0, 400), b.frame ?? null, Array.isArray(b.photos) ? b.photos.slice(0, 5) : [], Array.isArray(b.notes) ? b.notes.map(String) : []));
    if (b.mode === "watch" && b.frame && b.plan) {
      return Response.json(await watchFix(b.frame, {
        problem: String(b.problem ?? ""), plan: b.plan, current: Number(b.current) || 0,
        history: Array.isArray(b.history) ? b.history.slice(-6).map(String) : [], userSaid: b.userSaid ?? null, done: Array.isArray(b.done) ? b.done.map(String) : [],
      }));
    }
    if (b.mode === "replan" && b.frame && b.plan) {
      return Response.json(await replanFix(b.frame, {
        problem: String(b.problem ?? ""), plan: b.plan, current: Number(b.current) || 0,
        history: Array.isArray(b.history) ? b.history.slice(-6).map(String) : [], userSaid: null, done: Array.isArray(b.done) ? b.done.map(String) : [],
      }, Array.isArray(b.anomalies) ? b.anomalies : []));
    }
    return Response.json({ error: "bad request" }, { status: 400 });
  } catch (e) {
    console.error("[fix]", e);
    return Response.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
