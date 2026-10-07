import { summarize, type Level, type ReportInput } from "@/lib/guide";

/** POST /api/summary { plan, level, minutes, mistakes, questions, redone } -> the end-of-job report the learner shares and teaches from. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ReportInput;
    if (!body?.plan?.steps?.length) return Response.json({ error: "No job to summarize." }, { status: 400 });
    const level: Level = body.level === "advanced" || body.level === "intermediate" ? body.level : "newbie";
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 200)).slice(0, 12) : []);
    const report = await summarize({
      plan: body.plan,
      level,
      minutes: Number(body.minutes) || 0,
      mistakes: list(body.mistakes),
      questions: list(body.questions),
      redone: list(body.redone),
    });
    return Response.json({ report });
  } catch (e) {
    console.error("[summary]", e);
    return Response.json({ error: "Couldn't write the report. Try again." }, { status: 500 });
  }
}
