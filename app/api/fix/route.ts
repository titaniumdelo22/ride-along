import { planFix, watchFix, type FixStep } from "@/lib/fix";

/**
 * POST /api/fix
 *   { mode: "plan", problem, frame? }            -> FixPlan
 *   { mode: "watch", frame, step, userSaid? }    -> FixWatch
 */
export async function POST(req: Request) {
  try {
    const b = (await req.json()) as { mode: string; problem?: string; frame?: string | null; step?: FixStep; userSaid?: string | null };
    if (b.mode === "plan") return Response.json(await planFix(String(b.problem ?? "").slice(0, 400), b.frame ?? null));
    if (b.mode === "watch" && b.frame && b.step) return Response.json(await watchFix(b.frame, b.step, b.userSaid ?? null));
    return Response.json({ error: "bad request" }, { status: 400 });
  } catch (e) {
    console.error("[fix]", e);
    return Response.json({ error: String((e as Error).message || e) }, { status: 500 });
  }
}
