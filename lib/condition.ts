import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { haveCredentials, MODEL } from "./guide";

/** Is the machine in the camera put back together? Used by the scan page to say "not put back together" and offer the rebuild. */
export const REBUILD_TASK = "I took this apart. Help me put it back together the right way, every screw and tube where it goes.";

export const Condition = z.object({
  apart: z.boolean().describe("True if it is NOT fully put back together: a cover or panel off or loose, screws missing or lying around, a tube or wire disconnected"),
  state: z.string().nullable().describe("What's off, under 8 easy words, e.g. 'Back cover off, screws out'. Null if it's fully assembled"),
  missing: z.array(z.string()).describe("Up to 3 short things that still need to go back, e.g. 'back cover', '4 cover screws'. Empty if none"),
});
export type Condition = z.infer<typeof Condition>;

let client: Anthropic | null = null;

export async function condition(frame: string): Promise<Condition> {
  if (!haveCredentials()) return { apart: true, state: "Back cover off, screws out", missing: ["back cover", "cover screws"] };
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 400,
    system: "You are a journeyman checking a machine on a video call. Be accurate and very short, in words a 5th grader knows.",
    output_config: { effort: "low", format: zodOutputFormat(Condition) },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame } },
          { type: "text", text: "Is this machine fully put back together? Look for covers or panels off or loose, screw holes without screws, screws lying around, tubes or wires hanging loose." },
        ],
      },
    ],
  });
  if (!res.parsed_output) throw new Error("no condition");
  return res.parsed_output;
}
