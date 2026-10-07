import { planFix, watchFix, replanFix, type WatchContext, type Anomaly } from "@/lib/fix";

/**
 * POST /api/fix
 *   { mode: "plan", problem, frame? }                                  -> FixPlan
 *   { mode: "watch", frame, problem, plan, current, history, userSaid } -> FixWatch (may rewrite remaining steps)
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { mode: string; problem?: string; frame?: string | null; anomalies?: Anomaly[] } & Partial<WatchContext>;
    if (b.mode === "plan") return Response.json(await planFix(String(b.problem ?? "").slice(0, 400), b.frame ?? null));
    if (b.mode === "watch" && b.frame && b.plan) {
      return Response.json(await watchFix(b.frame, {
        problem: String(b.problem ?? ""), plan: b.plan, current: Number(b.current) || 0,
        history: Array.isArray(b.history) ? b.history.slice(-6).map(String) : [], userSaid: b.userSaid ?? null,
      }));
    }
    if (b.mode === "replan" && b.frame && b.plan) {
      return Response.json(await replanFix(b.frame, {
        problem: String(b.problem ?? ""), plan: b.plan, current: Number(b.current) || 0,
        history: Array.isArray(b.history) ? b.history.slice(-6).map(String) : [], userSaid: null,
      }, Array.isArray(b.anomalies) ? b.anomalies : []));
    }
    return Response.json({ error: "bad request" }, { status: 400 });
  } catch (e) {
    console.error("[fix]", e);
    return Response.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
