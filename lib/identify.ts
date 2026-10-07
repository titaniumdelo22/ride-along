import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { haveCredentials, MODEL, type Level } from "./guide";
import { PARTS } from "./parts";

/**
 * "What am I looking at?": for people who don't know where to start.
 * Point the camera at anything (an AC unit, an engine bay, a water heater) and
 * the coach names it, pins its main parts on screen, says what it does in plain
 * words, and, if the learner described a problem, where a pro would start.
 */

export const Identify = z.object({
  name: z.string().describe("What this is, 2 to 4 plain words, e.g. 'Water cooler'"),
  state: z
    .string()
    .nullable()
    .describe("What shape it's in RIGHT NOW if it isn't normal, under 8 words, e.g. 'Back cover off, screws out', 'Unplugged', 'Leaking at the base'. Null if it looks normal and closed up."),
  what: z.string().describe("ONE short sentence, under 12 simple words, on what it does"),
  parts: z
    .array(
      z.object({
        x: z.number().describe("0 to 1 from the left edge of the image"),
        y: z.number().describe("0 to 1 from the top edge of the image"),
        label: z.string().describe("1 to 3 words naming the part"),
        what: z.string().describe("Under 8 simple words: what this part does"),
      })
    )
    .describe("The 3 to 5 most important parts you can actually SEE in the image, where they are. Empty if no image."),
  focus: z
    .object({
      x: z.number().describe("0 to 1 from the left edge of the image"),
      y: z.number().describe("0 to 1 from the top edge of the image"),
      label: z.string().describe("1 to 3 words naming it"),
      why: z.string().describe("Under 10 easy words: why look here first"),
    })
    .nullable()
    .describe("The ONE most important thing to look at first, where you can see it in the image (for a problem: where to start; for parts: what goes back first). Null if no image."),
  tools: z
    .array(z.object({ icon: z.string().describe("ONE emoji"), name: z.string().describe("1 or 2 words") }))
    .describe("The 2 to 5 tools or supplies they need to grab to start, simplest first"),
  start: z
    .array(z.object({ title: z.string().describe("2 to 4 words"), how: z.string().describe("Under 10 simple words: how to check it") }))
    .describe("Where to start: the first 3 checks, most likely first. If no problem was described, the first 3 things to check on one that isn't working."),
  callPro: z.string().nullable().describe("If part of this is dangerous or a licensed job (gas, refrigerant, panel work, a blown engine), say so in under 15 words. Else null."),
  missions: z
    .array(z.object({ icon: z.string().describe("ONE emoji"), title: z.string().describe("2 to 5 words"), task: z.string().describe("The job, as the learner would say it") }))
    .describe("1 or 2 safe hands-on jobs they can do right now, best first"),
  say: z.string().describe("What the coach says out loud: name it and where to start. Under 25 words, 2 short sentences."),
});
export type Identify = z.infer<typeof Identify>;

const SYSTEM = `You are a patient journeyman with 25 years across the trades (HVAC, plumbing, electrical, appliances, auto), on a live video call. The person has NO idea what they're looking at, and may not read well. Name it, say what it does, point at the parts that matter, tell them what tools to grab and where to start.
- Very short. Write so a 5th grader gets it: short everyday words, short sentences.
- Point at ONE thing first (focus): the most important part to look at. Don't make them look at five things at once. No jargon; if you must use a trade word, explain it in 3 words.
- Be honest about danger: say plainly when something is a licensed pro's job, and what they CAN safely do.
- Only pin parts you can actually see. If unsure, say what it most likely is.
- Notice what condition it's in right now: covers off, taken apart, screws out, parts missing, unplugged, wet, burnt. Say that FIRST.
- If it's taken apart, your FIRST mission is putting it back together, and focus is the first thing that goes back on.`;

const UNIT = `If the item is a Clover D1 countertop hot-and-cold water cooler, here is where its parts are:
${PARTS.map((p) => `- ${p.label}: ${p.hint}`).join("\n")}`;

let client: Anthropic | null = null;

export type IdentifyMode = "what" | "parts";

const PARTS_CHECK = `PARTS CHECK: they took something apart and laid out the screws and pieces. Identify EACH screw, bolt, nut, washer, clip, bracket, fitting or panel you can see.
- Pin each kind once (x, y on the image). label: a letter and the type in 1 to 3 words, e.g. "A: Phillips pan-head". If several are identical, pin one and give the count.
- what: the type and where it goes, under 10 words, e.g. "Short sheet-metal screw · back panel, 4 of these". Say self-tapping, machine or wood screw, and short or long, when you can tell.
- tools: the exact screwdriver or bit sizes they need (e.g. "Phillips #2", "1/4 in nut driver").
- start: up to 3 tips for putting them back (which go where first, longest ones go where, don't overtighten into plastic).
- name: what's on the table, e.g. "8 screws, 2 clips". missions: one, putting it back together.
- If before photos are given, match each part to where it came out in them.`;

export async function identify(frame: string | null, problem: string, level: Level = "newbie", mode: IdentifyMode = "what", befores: string[] = []): Promise<Identify> {
  if (!haveCredentials()) return MOCK;
  const content: Anthropic.ContentBlockParam[] = [];
  befores.forEach((b, i) => {
    content.push({ type: "text", text: `Before photo ${i} (taken as it came apart):` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b } });
  });
  if (frame) {
    if (befores.length) content.push({ type: "text", text: "Their camera right now:" });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame } });
  }
  content.push({
    type: "text",
    text: `${frame ? "This is what their camera sees." : "There's no camera image, go from their words."}
${problem ? `They say: "${problem}".` : "They didn't describe a problem; they just want to know what this is."}
They are a ${level}. ${mode === "parts" ? PARTS_CHECK : "What are they looking at, and where should they start?"}
${UNIT}`,
  });
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(Identify) },
    messages: [{ role: "user", content }],
  });
  if (!res.parsed_output) throw new Error("no identify");
  return res.parsed_output;
}

const MOCK: Identify = {
  name: "Water cooler",
  state: null,
  what: "A tiny fridge that keeps drinking water cold.",
  parts: [
    { x: 0.6, y: 0.5, label: "Label", what: "Model, power, and coolant type" },
    { x: 0.3, y: 0.45, label: "Coils", what: "Let the heat out" },
    { x: 0.42, y: 0.8, label: "Screws", what: "Hold the coils on" },
  ],
  tools: [
    { icon: "🔦", name: "Flashlight" },
    { icon: "🧤", name: "Gloves" },
    { icon: "🖌️", name: "Soft brush" },
  ],
  start: [
    { title: "Check the plug", how: "Plugged in? Switches on the back on?" },
    { title: "Look at the coils", how: "Gray dust on them means it can't cool." },
    { title: "Give it space", how: "Pull it a few inches off the wall." },
  ],
  focus: { x: 0.3, y: 0.45, label: "Coils", why: "Dust here stops it getting cold." },
  callPro: "The coolant inside is a licensed job. Don't cut or bend the tubes.",
  missions: [{ icon: "🧽", title: "Get it cold again", task: "This water cooler is out of order and won't get cold. Help me fix it." }],
  say: "That's a water cooler, a tiny fridge for water. First, let's check the plug and the coils on the back.",
};
