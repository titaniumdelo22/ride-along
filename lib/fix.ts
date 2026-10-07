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

export const FixWatch = z.object({
  see: z.string().describe("One short sentence: what is in the camera"),
  stepDone: z.boolean().describe("True only if the camera clearly shows the step's check is met"),
  say: z.string().nullable().describe("One short sentence to say now, or null to stay quiet"),
  safety: z.string().nullable().describe("Urgent safety warning if something unsafe is happening, else null"),
});
export type FixWatch = z.infer<typeof FixWatch>;

const PARTS_DESC = PARTS.map((p) => `- ${p.label}: ${p.hint}`).join("\n");

const COACH = `You are a patient journeyman appliance technician on a live video call with a learner who is fixing a Clover D1 hot-and-cold water cooler. You can see their camera. Short, plain, hands-on, one thing at a time. Safety beats speed: anything behind the back panel or near the hot tank means unplug first.
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

export async function watchFix(frame: string, step: FixStep, userSaid: string | null): Promise<FixWatch> {
  const res = await anthropic().messages.parse({
    model: WATCH_MODEL,
    max_tokens: 600,
    system: COACH,
    output_config: { effort: "low", format: zodOutputFormat(FixWatch) },
    messages: [{ role: "user", content: [img(frame), { type: "text", text: `Current step: "${step.title}". Instruction: ${step.instruction}
Done when the camera shows: ${step.check}
${userSaid ? `The learner just said: "${userSaid}". Answer them in one sentence.` : "Stay quiet (say: null) unless something needs saying."}
Look at the frame and respond.` }] }],
  });
  if (!res.parsed_output) throw new Error("no watch");
  return res.parsed_output;
}
