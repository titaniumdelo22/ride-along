import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { PARTS, LABELS } from "./parts";

/**
 * Fix flow for the Scan page.
 *   planFix(problem, frame)  - Claude Fable 5.1 reads what the user says is wrong (+ a camera frame) and writes
 *                              the repair steps. Each step names the parts from lib/parts that matter, so the
 *                              overlay can light up only those.
 *   watchFix(frame, step)    - a quick look at the newest frame: is this step done? what to say?
 */

export const PLAN_MODEL = process.env.PLAN_MODEL || "claude-fable-5-1";
export const WATCH_MODEL = process.env.WATCH_MODEL || "claude-opus-5-5";

export const FixStep = z.object({
  title: z.string().describe("2 to 4 words, e.g. 'Unplug the cooler'"),
  instruction: z.string().describe("One or two short spoken sentences telling the learner exactly what to do"),
  check: z.string().describe("What the camera must SHOW for this step to count as done"),
  parts: z.array(z.string()).describe(`The parts involved in this step. ONLY values from: ${LABELS.join(", ")}. Empty list if none.`),
  safety: z.string().nullable().describe("A short safety warning, or null"),
});
export type FixStep = z.infer<typeof FixStep>;

export const FixPlan = z.object({
  diagnosis: z.string().describe("One or two plain sentences: the most likely cause, said like a pro on a call"),
  intro: z.string().describe("What the coach says first: one warm sentence"),
  tools: z.array(z.string()).describe("Tools and supplies, short names"),
  steps: z.array(FixStep).describe("4 to 8 steps, in order, each one physical action"),
});
export type FixPlan = z.infer<typeof FixPlan>;

export const Anomaly = z.object({
  part: z.string().describe(`Which known part, from: ${LABELS.join(", ")}`),
  issue: z.string().describe("What is wrong, in a few plain words, e.g. 'white wire off its terminal screw'"),
  box_2d: z.array(z.number()).describe("[ymin, xmin, ymax, xmax] on a 0-1000 scale, tight around the problem spot"),
});
export const FixWatch = z.object({
  see: z.string().describe("One short sentence: what is in the camera right now, which parts, how close"),
  stepDone: z.boolean().describe("True only if the camera clearly shows the current step's check is met"),
  say: z.string().nullable().describe("One or two short sentences to say now, or null to stay quiet. Be specific: name the part and what correct looks like."),
  aim: z.string().nullable().describe("If you need a different view, exactly where to point the camera and how close, else null"),
  anomalies: z.array(Anomaly).describe("Anything that looks wrong in THIS frame: a wire off a screw, a connector hanging, a part missing or damaged. Empty if everything visible looks normal. Never guess."),
  safety: z.string().nullable().describe("Urgent safety warning if something unsafe is happening, else null"),
  replaceRemainingSteps: z.array(FixStep).nullable().describe("If what you see changes the plan, the NEW remaining steps after the current one (replace all later steps). Null to keep the plan."),
});
export type FixWatch = z.infer<typeof FixWatch>;
export type Anomaly = z.infer<typeof Anomaly>;

const PARTS_DESC = PARTS.map((p) => `- ${p.label}: ${p.hint}`).join("\n");

const COACH = `You are a patient journeyman appliance technician on a live video call with a learner who is fixing a Clover D1 countertop hot-and-cold water cooler (serial 14123673, 120 V, R134a). You can see their camera. Short, plain, hands-on, one thing at a time. Safety beats speed: anything inside the back means unplug first; the hot tank is scalding and the harness is live at 120 V when plugged in.

How this unit is laid out (the back cover is already removed for the demo, so the inside is visible):
- Front: red PUSH hot tap with a child lock, dark cold paddle, HOT and COLD indicator lights, drip tray.
- Top: round white cold tank with a gray foam lid, clear water inlet tube.
- Inside the back: compressor (black dome) with its relay box, filter dryer and coiled capillary tube in copper, black foam-wrapped hot tank, a gray terminal block with three screws on the floor where the green ground wire and white wires are held, a harness of red/yellow/white/brown wires with spade connectors, red rocker hot water switch, data plate, power cord. Condenser coils are the black grid on the back.

Diagnose from what the learner tells you and what you can see in the camera. Do not assume a cause; ask them to show you things and reason like a technician.
Rules for steps:
- The back cover is off, so steps must send the camera INSIDE: close on the terminal block, the relay, each connector, the switch. "Hold the phone about 20 cm from the terminal block so I can see all three screws" is a good instruction; "show me the back" is not.
- Each instruction names the exact part and what CORRECT looks like, so the learner can compare.
- This is troubleshooting, not a checklist: look, compare, decide, then act.
Rules for calling something wrong:
- Being unplugged is NOT a fault. If the unit may simply be unplugged or switched off, the first step is to plug it in / switch it on and watch the lights before anything else.
- Never call a wire, connector or part loose, broken or damaged unless the camera clearly shows it or the learner has described it. A connector that is merely out of focus or partly hidden is not loose. If you are not sure, say what to check, not what is broken.
- If after plugging in everything works, say so and finish early: "Looks like it just needed plugging in." Do not invent work.

Known parts of this machine (use these exact names when you refer to them):
${PARTS_DESC}`;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());
const img = (frame: string) => ({ type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: frame } });

export async function planFix(problem: string, frame: string | null): Promise<FixPlan> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (frame) content.push(img(frame));
  content.push({
    type: "text",
    text: `The learner says: "${problem}".
${frame ? "The camera frame above shows the machine right now; use anything you can see." : ""}
Diagnose the most likely cause and write the step-by-step repair a journeyman would walk them through. Each step is one physical action with what you will check on camera, and lists the parts involved using only the known part names.`,
  });
  const res = await anthropic().messages.parse({
    model: PLAN_MODEL,
    max_tokens: 3000,
    system: COACH,
    output_config: { effort: "low", format: zodOutputFormat(FixPlan) },
    messages: [{ role: "user", content }],
  });
  if (!res.parsed_output) throw new Error("no plan");
  // keep only known part names
  for (const s of res.parsed_output.steps) s.parts = s.parts.map((p) => p.toLowerCase().trim()).filter((p) => LABELS.includes(p));
  return res.parsed_output;
}

export type WatchContext = {
  problem: string;
  plan: FixPlan;
  current: number;
  history: string[]; // what you observed on previous looks, oldest first
  userSaid: string | null;
};

export async function watchFix(frame: string, ctx: WatchContext): Promise<FixWatch> {
  const step = ctx.plan.steps[ctx.current];
  const res = await anthropic().messages.parse({
    model: PLAN_MODEL,
    max_tokens: 2500,
    system: COACH,
    output_config: { effort: "low", format: zodOutputFormat(FixWatch) },
    messages: [{ role: "user", content: [img(frame), { type: "text", text: `Problem the learner reported: "${ctx.problem}"
Your diagnosis so far: ${ctx.plan.diagnosis}
Plan: ${ctx.plan.steps.map((s, i) => `${i + 1}. ${s.title}`).join("; ")}
Current step ${ctx.current + 1}: "${step.title}". Instruction: ${step.instruction}
Done when the camera shows: ${step.check}
${ctx.history.length ? `What you saw on earlier looks (oldest first):
${ctx.history.map((h) => `- ${h}`).join("\n")}` : "This is your first look."}
${ctx.userSaid ? `The learner just said: "${ctx.userSaid}". Answer them directly in 'say'.` : "The learner said nothing new. Stay quiet (say: null) unless something needs saying or the view must change."}
Look closely at THIS frame. Compare every visible wire, connector and part to how it should be. Report anomalies only when clearly visible. If what you see changes what should happen next, rewrite the remaining steps.` }] }],
  });
  if (!res.parsed_output) throw new Error("no watch");
  const w = res.parsed_output;
  w.anomalies = w.anomalies.filter((a) => a.box_2d?.length === 4).map((a) => ({ ...a, part: a.part.toLowerCase().trim() }));
  if (w.replaceRemainingSteps) for (const st of w.replaceRemainingSteps) st.parts = st.parts.map((p) => p.toLowerCase().trim()).filter((p) => LABELS.includes(p));
  return w;
}
