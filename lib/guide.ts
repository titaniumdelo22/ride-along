import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { PARTS } from "./parts";

// Philip's map of the demo unit, so Ray knows this exact machine (the model ignores it for anything else).
const UNIT = `If the item is a Clover D1 countertop hot-and-cold water cooler (serial 14123673), here is where its parts are:
${PARTS.map((p) => `- ${p.label}: ${p.hint}`).join("\n")}`;

/**
 * Ride Along's coach: a journeyman who watches the live camera and talks the
 * learner through a hands-on job, one step at a time.
 *
 * Two calls:
 *   plan()  - read the task (and the label, if the camera sees one), write the steps.
 *   watch() - look at the newest camera frame, decide if the current step is done,
 *             say something only when it helps, point at the part that matters,
 *             and call out anything unsafe.
 *
 * With no API credentials (ANTHROPIC_API_KEY unset) both fall back to a scripted
 * walkthrough of a water dispenser filter change, so the app always demos.
 */

export const MODEL = "claude-opus-5-5";

export const Step = z.object({
  icon: z.string().describe("ONE emoji that pictures the action, e.g. 🔌 🔧 🔦 🧽 📋 ⚡ 💧 👀"),
  title: z.string().describe("2 to 4 words, e.g. 'Turn off the water'"),
  instruction: z.string().describe("ONE short spoken sentence, under 15 simple words, telling them exactly what to do"),
  check: z.string().describe("What the coach must SEE in the camera to know this step is done"),
  why: z.string().describe("Why, in under 12 simple words"),
  safety: z.string().nullable().describe("A safety warning in under 12 words, or null"),
  skill: z.string().describe("The trade skill this step trains, 2 to 3 words"),
  photo: z
    .number()
    .nullable()
    .describe("Only when putting something back together from before photos: the 0-based index of the photo that shows how this part should look. Else null."),
});
export type Step = z.infer<typeof Step>;

export const Plan = z.object({
  product: z.object({
    name: z.string().describe("What the item is, e.g. 'Countertop water dispenser'"),
    model: z.string().nullable().describe("Model number if readable on a label, else null"),
    serial: z.string().nullable().describe("Serial number if readable on a label, else null"),
  }),
  trade: z.string().describe("The trade this belongs to, e.g. Plumbing, HVAC, Appliance repair, Electrical"),
  tools: z
    .array(
      z.object({
        icon: z.string().describe("ONE emoji for the tool"),
        name: z.string().describe("Short tool name, 1 to 3 words"),
        need: z.boolean().describe("true if the job can't be done right or safely without it; false if it only helps"),
      })
    )
    .describe("Every tool and supply needed for this job, in the order they are used"),
  steps: z.array(Step).describe("4 to 8 steps, in order"),
  hazards: z
    .array(z.object({ icon: z.string().describe("ONE emoji"), text: z.string().describe("The hazard and how to stay safe, under 10 easy words") }))
    .describe("2 to 4 real hazards on this job (power, hot water, sharp edges, refrigerant lines, heavy or falling things), most serious first"),
  startAt: z
    .number()
    .describe("0-based index of the step to start on. If they're already partway or stuck, the step they're stuck at (or the one quick safety check right before it), never the beginning. If they haven't started, 0."),
  intro: z.string().describe("What the coach says first: one warm short sentence, under 15 words"),
});
export type Plan = z.infer<typeof Plan>;

/** The quick first answer: what the item is and the gear to grab. Shows in seconds while the steps are still being written. */
export const Kit = Plan.pick({ product: true, trade: true, tools: true });
export type Kit = z.infer<typeof Kit>;

export const Watch = z.object({
  see: z.string().describe("One short sentence: what is in the camera right now"),
  stepDone: z.boolean().describe("True only if the camera clearly shows the current step's check is met"),
  say: z.string().nullable().describe("What to say out loud now: ONE short sentence under 15 simple words (up to two when answering them), or null to stay quiet"),
  point: z
    .object({
      x: z.number().describe("0 to 1 from the left edge of the image"),
      y: z.number().describe("0 to 1 from the top edge of the image"),
      label: z.string().describe("2 to 4 words naming the part, e.g. 'Shutoff valve'"),
    })
    .nullable()
    .describe("Where the part being talked about is in the image, or null"),
  aim: z
    .enum(["closer", "farther", "left", "right", "up", "down"])
    .nullable()
    .describe("Which way the learner should move the camera so you can see what you need, or null if the view is fine"),
  safety: z.string().nullable().describe("An urgent safety warning if something unsafe is happening, else null"),
  mistake: z.string().nullable().describe("A mistake the learner just made, in a few words, else null"),
  drop: z.array(z.string()).describe("Titles of UPCOMING steps the camera shows aren't needed (already done, or not on this unit). Usually empty."),
  surprise: z
    .object({
      what: z.string().describe("The unexpected thing, under 8 words, e.g. 'Water pooling under the unit'"),
      steps: z.array(Step).describe("1 to 3 new steps to deal with it before going on; empty if nothing extra is needed"),
    })
    .nullable()
    .describe("ONLY when something unexpected shows up that changes the plan: a leak, burn marks, a stuck or stripped screw, rust, a broken or missing part, a different setup than planned. Else null. Never repeat one already handled."),
});
export type Watch = z.infer<typeof Watch>;

export const Report = z.object({
  headline: z.string().describe("Under 12 words, like a work order line, e.g. 'Fixed a warm water cooler by cleaning the dusty coils'"),
  didWhat: z.string().describe("2 short first-person sentences ('I ...'), under 35 simple words total, they can say to a boss or a friend"),
  learned: z.array(z.string()).describe("3 takeaways, each under 10 simple words"),
  teachBack: z.array(z.string()).describe("3 steps to teach this to someone newer, in order, each under 10 simple words"),
  nextTime: z.string().describe("One tip for next time, under 12 words, based on what happened"),
});
export type Report = z.infer<typeof Report>;

export type ReportInput = {
  plan: Plan;
  level?: Level;
  minutes: number;
  mistakes: string[];
  questions: string[];
  redone: string[]; // steps the learner went back to
  surprises?: string[]; // curveballs that came up
};

export type Level = "newbie" | "intermediate" | "advanced";

const LEVEL_PLAN: Record<Level, string> = {
  newbie: "The learner is a NEWBIE: never done this. Use 6 to 9 small steps, plain words with every trade term explained the first time, extra safety, and nothing assumed.",
  intermediate: "The learner is INTERMEDIATE: knows basic tools and safety. Use 5 to 7 steps, normal trade words, short explanations.",
  advanced: "The learner is ADVANCED: a working tech. Use 3 to 5 bigger steps, trade terms, skip basics, focus on diagnosis and the checks a pro would make.",
};
const LEVEL_WATCH: Record<Level, string> = {
  newbie: "NEWBIE: go slow, confirm each small move, explain why, encourage often.",
  intermediate: "INTERMEDIATE: normal pace, short tips, explain only when they hesitate.",
  advanced: "ADVANCED: be brief, speak only when it matters (a check they skipped, a mistake, a safety issue), use trade terms.",
};

export type WatchInput = {
  level?: Level;
  frame: string | null; // base64 JPEG, no data: prefix
  task: string;
  plan: Plan;
  current: number;
  teach: boolean;
  recent: string[]; // what the coach said lately, newest last
  talk?: { who: "ray" | "you"; text: string }[]; // the conversation so far, newest last
  surprises?: string[]; // curveballs already handled on this job
  done?: string[]; // steps already finished
  missingTools?: string[]; // tools they said they don't have
  ref?: string | null; // a before photo of how this step should end up (putting it back together)
  userSaid: string | null;
};

const COACH = `You are a patient journeyman with 25 years in the trades, on a live video call with a learner (an apprentice or a new technician). You can see their camera. You teach the way pros teach on the job: short, plain, hands-on, one thing at a time, and you never let them do something unsafe.
- The learner's hands are busy and they may not read well: everything important must be SAID, short and plain. Write so a 5th grader gets it: short everyday words; if you use a trade word, explain it in 3 words. Talk like a person on a call, not a manual. One short sentence at a time.
- If you can't see what you need, tell them where to move the camera (aim) and say it.
- Stay quiet when nothing needs saying (say: null). Never repeat yourself.
- Only mark a step done when the camera clearly shows it, or they tell you they already did it.
- Point at the exact part you mean when it helps.
- Safety beats speed, always. Hazards first: live power (120 V), hot water from the hot tank, sharp sheet-metal edges, refrigerant lines (never cut or bend), heavy or falling things, water near a plug. If you see one, use safety to stop them.
- This is a LIVE call: you get a fresh frame every second or two. Keep "see" under 8 words. When something changes, react like a person on FaceTime with 2 to 6 words ("Yep, that's it." "Little closer." "Good, keep going."), but don't narrate every frame.
- It's a conversation: remember what they told you and what they already tried, and build on it.
- If they ask about a screw or small part, say exactly which one (head type, short or long, sheet-metal or machine) and where it goes, and point at it.
- Real jobs never go exactly to plan. Watch for curveballs: a leak, burn marks, a stuck screw, rust, a broken or missing part, a setup that doesn't match the plan. When one shows up, stay calm, say what you see, and add the steps to handle it. That is the most valuable thing you teach.`;

export function haveCredentials(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

function imageBlock(frame: string) {
  return { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: frame } };
}

export async function plan(task: string, frame: string | null, level: Level = "newbie", befores: string[] = []): Promise<Plan> {
  if (!haveCredentials()) return MOCK_PLAN;
  const content: Anthropic.ContentBlockParam[] = [];
  befores.forEach((b, i) => {
    content.push({ type: "text", text: `Before photo ${i}:` });
    content.push(imageBlock(b));
  });
  if (frame) {
    if (befores.length) content.push({ type: "text", text: "The live camera right now:" });
    content.push(imageBlock(frame));
  }
  content.push({
    type: "text",
    text: `The learner says they are working on: "${task || "the item in the camera"}".
${frame ? "The camera frame above may show the item and its label; read the model and serial number if you can." : ""}
${LEVEL_PLAN[level]}
${UNIT}
If it's taken apart (covers off, screws out), this job is putting it back together: inside parts first (tubes, wires, connectors seated), then one step per cover or panel whose check is "every screw hole on it has a screw", then a leak check and a power-on test.
Mark each tool need true only if the job can't be done right or safely without it. List the real hazards.
Write the step-by-step plan a journeyman would walk them through, hands-on, in order, with what you'll check on camera for each step, and every tool they need before they start.
${befores.length ? `PUTTING IT BACK TOGETHER: the ${befores.length} before photos were taken while it came apart, in order (photo 0 first, before anything was removed). Write the steps to put it back together in reverse, one part at a time, and set each step's photo to the index of the before photo that shows how that part should look. Cover every tube on the right fitting, every screw back in, then a leak check and a power-on test.` : ""}
They may already be partway through ("I'm stuck at...", or the camera shows it half done). Then don't start over: write the whole job, set startAt to the step they're on or stuck at, and in the intro say where you're picking up. If a safety step before it (power off, water off) isn't clearly done, make the step at startAt ONE quick check that it is, right before the step they're stuck on.`,
  });
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system: COACH,
    output_config: { effort: "low", format: zodOutputFormat(Plan) },
    messages: [{ role: "user", content }],
  });
  if (!res.parsed_output) throw new Error("no plan");
  return res.parsed_output;
}

export async function kit(task: string, frame: string | null, level: Level = "newbie"): Promise<Kit> {
  if (!haveCredentials()) return { product: MOCK_PLAN.product, trade: MOCK_PLAN.trade, tools: MOCK_PLAN.tools };
  const content: Anthropic.ContentBlockParam[] = [];
  if (frame) content.push(imageBlock(frame));
  content.push({
    type: "text",
    text: `The learner says they are working on: "${task || "the item in the camera"}".
${frame ? "The camera frame above may show the item and its label; read the model and serial number if you can." : ""}
${LEVEL_PLAN[level]}
Name the item and list every tool and supply they need to grab before they start, in the order they'll use them. Keep it to the real essentials (3 to 8).`,
  });
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 1000,
    system: COACH,
    output_config: { effort: "low", format: zodOutputFormat(Kit) },
    messages: [{ role: "user", content }],
  });
  if (!res.parsed_output) throw new Error("no kit");
  return res.parsed_output;
}

export async function watch(input: WatchInput): Promise<Watch> {
  if (!haveCredentials()) return mockWatch(input);
  const step = input.plan.steps[input.current];
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.frame) content.push(imageBlock(input.frame));
  if (input.ref) {
    content.push({ type: "text", text: "Before photo: how this looked BEFORE it came apart." });
    content.push(imageBlock(input.ref));
  }
  content.push({
    type: "text",
    text: `${input.ref ? "PUTTING IT BACK TOGETHER: compare the live camera (first image) with the before photo. Say what still doesn't match (a tube on the wrong fitting, a missing screw, a part flipped) and point at it on the live image. Only call the step done when it matches.\n" : ""}Job: ${input.plan.product.name}${input.plan.product.model ? ` (model ${input.plan.product.model})` : ""}.
Current step ${input.current + 1} of ${input.plan.steps.length}: "${step.title}". Instruction: ${step.instruction}
Done when the camera shows: ${step.check}
${step.safety ? `Safety for this step: ${step.safety}` : ""}
Steps already done: ${input.done?.length ? input.done.join(", ") : "none yet"}.
Steps after this: ${input.plan.steps.slice(input.current + 1).map((s) => s.title).join(", ") || "none, this is the last one"}.
${input.missingTools?.length ? `Tools they DON'T have: ${input.missingTools.join(", ")}. Never tell them to use these: give a safe workaround, or if one is truly needed, say so plainly and don't let them do that part without it.` : ""}
Don't stick to the plan when the camera says otherwise: if an earlier step was missed (an empty screw hole, a loose tube or wire), add a step to fix it now with surprise; if an upcoming step isn't needed, put its exact title in drop.
Putting things back together: a cover or panel is NOT done until every screw hole on it has a screw. Count them on camera and name the empty one.
Curveballs already handled: ${input.surprises?.length ? input.surprises.join("; ") : "none"}.
Learner level: ${LEVEL_WATCH[input.level ?? "newbie"]}
${input.teach ? "TEACH MODE: when a step finishes, before telling them the next one, ask what they think comes next and why. Praise right answers, correct wrong ones kindly." : ""}
${input.talk?.length ? `The conversation so far (newest last): ${input.talk.map((t) => `${t.who === "you" ? "Learner" : "You"}: "${t.text}"`).join(" | ")}` : `What you said lately: ${input.recent.length ? input.recent.map((s) => `"${s}"`).join(" ") : "(nothing yet)"}`}
${input.userSaid ? `The learner just said: "${input.userSaid}". Answer them directly, like on a phone call. If they tried something and it still isn't working, do NOT repeat the same instruction: give the next likely cause and the next thing to try (or ask one quick question), and add steps for it with surprise if needed.` : "The learner hasn't said anything new."}
Look at the camera frame and respond.`,
  });
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 1500,
    system: COACH,
    output_config: { effort: "low", format: zodOutputFormat(Watch) },
    messages: [{ role: "user", content }],
  });
  if (!res.parsed_output) throw new Error("no watch");
  return res.parsed_output;
}

export async function summarize(input: ReportInput): Promise<Report> {
  if (!haveCredentials()) return mockReport(input);
  const p = input.plan;
  const text = `The learner (level: ${input.level ?? "newbie"}) just finished this job with you on a video call.
Item: ${p.product.name}${p.product.model ? `, model ${p.product.model}` : ""}${p.product.serial ? `, serial ${p.product.serial}` : ""}. Trade: ${p.trade}.
Steps they did: ${p.steps.map((s, i) => `${i + 1}. ${s.title} (${s.skill}): ${s.why}`).join(" ")}
Time: about ${Math.max(1, Math.round(input.minutes))} minutes.
Mistakes you caught: ${input.mistakes.length ? input.mistakes.join("; ") : "none"}.
Questions they asked: ${input.questions.length ? input.questions.join("; ") : "none"}.
Steps they went back to: ${input.redone.length ? input.redone.join("; ") : "none"}.
Curveballs that came up and how they handled them: ${input.surprises?.length ? input.surprises.join("; ") : "none"}.
Write their job report: plain words, warm, specific to what happened on THIS job, so they can explain it to others and teach it.`;
  const res = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 1500,
    system: COACH,
    output_config: { effort: "low", format: zodOutputFormat(Report) },
    messages: [{ role: "user", content: text }],
  });
  if (!res.parsed_output) throw new Error("no report");
  return res.parsed_output;
}

function mockReport(input: ReportInput): Report {
  const p = input.plan;
  return {
    headline: `Restored cooling on a ${p.product.name} ${p.product.model ?? ""} by cleaning clogged condenser coils`.replace(/\s+/g, " "),
    didWhat: "I unplugged the cooler, read the data plate, and found the condenser coils on the back caked in dust. I brushed them clean with the tubes, found the cold thermostat on the wiring diagram, and powered it back on with room to breathe.",
    learned: ["Unplug first: there's 120 volts and a hot tank in there.", "Most no-cool calls are airflow, not refrigerant.", "Brush coils with the tubes, never across them."],
    teachBack: ["Start with safety: unplug it and wait for the hot tank to cool.", "Read the data plate before you diagnose anything.", "Show them the coils and explain that dust is a blanket on the heat.", "Brush top to bottom with the tubes, then leave a few inches behind it."],
    nextTime: input.mistakes.length ? "Go with the tubes from the first stroke, slow and light." : "Check the coils every six months so it never gets this bad.",
  };
}

// ── Practice mode: a scripted water dispenser filter change ─────────────────

export const MOCK_PLAN: Plan = {
  product: { name: "Clover water cooler", model: "D1", serial: "14123673" },
  trade: "Appliance and refrigeration (HVAC-R)",
  tools: [
    { icon: "🔦", name: "Flashlight", need: true },
    { icon: "🖌️", name: "Soft coil brush", need: true },
    { icon: "🧹", name: "Shop vac", need: false },
    { icon: "🧤", name: "Work gloves", need: true },
    { icon: "🧻", name: "Towel", need: false },
  ],
  hazards: [
    { icon: "⚡", text: "120 volts inside. Unplug before you touch it." },
    { icon: "🔥", text: "Hot tank water can burn. Let it cool." },
    { icon: "🔪", text: "Sheet-metal edges are sharp. Wear gloves." },
  ],
  startAt: 0,
  intro: "Hey, I've got you. I can read the label: Clover D1, 120 volts, R134a refrigerant. When one of these stops getting cold, the first suspect is airflow. Let's check it the safe way.",
  steps: [
    { icon: "🔌", title: "Unplug the cooler", instruction: "Pull the plug out of the wall before you touch anything behind it.", check: "The plug is out of the outlet", why: "There's 120 volts to the compressor and a hot tank heater in there.", safety: "Never reach into the back of a plugged-in unit. The hot tank can also burn you.", skill: "Lockout and safety", photo: null },
    { icon: "🏷️", title: "Read the data plate", instruction: "Show me the label on the back: model, volts, amps, refrigerant.", check: "The model and serial label is readable in the camera", why: "The plate tells you the refrigerant, the amps it should draw and the pressures it's built for, before you diagnose anything.", safety: null, skill: "Reading a data plate", photo: null },
    { icon: "🔦", title: "Look at the condenser coils", instruction: "Shine a light on the black coils on the back. See all that gray fuzz? That's dust blocking the heat from getting out.", check: "The condenser coils are in view", why: "A fridge cools by dumping heat through these coils. Dust is a blanket on them, so the water never gets cold.", safety: null, skill: "Spotting airflow problems", photo: null },
    { icon: "🧽", title: "Clean the coils", instruction: "Brush the coils gently, top to bottom, following the tubes. Don't bend the wires.", check: "The coils look clean, with no gray dust", why: "Going with the tubes lifts the dust off instead of packing it into the fins.", safety: "Coils can have sharp edges. Go slow.", skill: "Condenser cleaning", photo: null },
    { icon: "📋", title: "Find it on the wiring diagram", instruction: "Now show me the wiring sticker. Point at the cold water thermostat.", check: "The wiring diagram sticker is in view", why: "The thermostat is the switch that tells the compressor to run. Knowing where it sits on the diagram is how you trace a no-cool problem.", safety: null, skill: "Reading a wiring diagram", photo: null },
    { icon: "⚡", title: "Power on and listen", instruction: "Push it back, leave a few inches of space behind it, and plug it in. Listen for the compressor to start.", check: "The cooler is plugged in and the cold lamp is on", why: "A few inches of space lets the clean coils breathe. The hum is the compressor starting.", safety: null, skill: "Startup and verification", photo: null },
  ],
};

const MOCK_POINTS = [
  { x: 0.7, y: 0.85, label: "Power cord" },
  { x: 0.55, y: 0.45, label: "Data plate" },
  { x: 0.6, y: 0.6, label: "Condenser coils" },
  { x: 0.6, y: 0.6, label: "Condenser coils" },
  { x: 0.55, y: 0.4, label: "Cold water thermostat" },
  { x: 0.5, y: 0.75, label: "Cold lamp" },
];

let mockTicks = 0;
let mockStep = -1;
function mockWatch(input: WatchInput): Watch {
  const w = mockWatchBase(input);
  if (input.current === 2 && mockTicks === 2 && !input.surprises?.length) {
    return {
      ...w,
      stepDone: false,
      say: "Hold on, I see water on the floor under it. Let's check that first.",
      point: { x: 0.5, y: 0.9, label: "Water on the floor" },
      surprise: {
        what: "Water pooling under the cooler",
        steps: [
          { icon: "💧", title: "Check the drip tray", instruction: "Pull out the tray under the taps and empty it.", check: "The drip tray is out and empty", why: "A full tray often looks like a leak.", safety: null, skill: "Finding a leak", photo: null },
          { icon: "🧻", title: "Dry it and watch", instruction: "Dry the floor, then watch it for a minute.", check: "The floor under the cooler is dry", why: "If it comes back, the leak is inside.", safety: "Keep water away from the plug.", skill: "Leak tracing", photo: null },
        ],
      },
    };
  }
  return w;
}

function mockWatchBase(input: WatchInput): Omit<Watch, "surprise"> & { surprise: null, drop: [] } {
  if (mockStep !== input.current) {
    mockStep = input.current;
    mockTicks = 0;
  }
  mockTicks++;
  const step = input.plan.steps[input.current];
  const point = MOCK_POINTS[input.current] ?? null;
  if (input.userSaid) {
    return { see: "The learner is asking a question.", stepDone: false, say: `Good question. ${step.why} You're doing fine, take your time.`, point, aim: null, safety: null, mistake: null, surprise: null, drop: [] };
  }
  if (mockTicks === 1 && input.current === 1) {
    return { see: "The label is too far away to read.", stepDone: false, say: "Get a little closer to that label so I can read it.", point, aim: "closer", safety: null, mistake: null, surprise: null, drop: [] };
  }
  if (mockTicks === 1 && input.current === 2) {
    return { see: "Looking at the side of the unit.", stepDone: false, say: "Swing around to the back, where the black coils are.", point: null, aim: "right", safety: null, mistake: null, surprise: null, drop: [] };
  }
  if (mockTicks === 1) return { see: "The unit is in view.", stepDone: false, say: null, point, aim: null, safety: null, mistake: null, surprise: null, drop: [] };
  if (mockTicks === 2 && input.current === 3) {
    return { see: "Brushing across the coils.", stepDone: false, say: "Easy, you're brushing across the tubes and packing dust in. Go top to bottom, with the tubes.", point, aim: null, safety: null, mistake: "Brushed across the coils instead of with them", surprise: null, drop: [] };
  }
  if (mockTicks >= 4) {
    const next = input.plan.steps[input.current + 1];
    const say = next
      ? input.teach
        ? `Nice, that's done. What do you think comes next, and why?`
        : `That's it, nice work. Next: ${next.instruction}`
      : "That's the job. Clean coils, good airflow. Give it twenty minutes and that water will be cold.";
    return { see: "The step is done.", stepDone: true, say, point: next ? MOCK_POINTS[input.current + 1] ?? null : null, aim: null, safety: null, mistake: null, surprise: null, drop: [] };
  }
  return { see: "Working on it.", stepDone: false, say: null, point, aim: null, safety: null, mistake: null, surprise: null, drop: [] };
}
