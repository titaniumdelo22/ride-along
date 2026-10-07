import { haveCredentials, plan } from "@/lib/guide";


/** POST /api/plan { task, frame? } -> the job's steps (practice mode without credentials). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { task?: string; frame?: string | null };
    const p = await plan(String(body.task ?? "").slice(0, 300), body.frame ?? null);
    return Response.json({ plan: p, live: haveCredentials() });
  } catch (e) {
    console.error("[plan]", e);
    return Response.json({ error: "The coach couldn't plan that. Try again." }, { status: 500 });
  }
}
