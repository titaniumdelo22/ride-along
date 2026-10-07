/**
 * POST /api/tts { text } -> audio/mpeg from Cartesia, using the cloned voice named in CARTESIA_VOICE (default "Chris").
 * Set CARTESIA_API_KEY (and optionally CARTESIA_VOICE_ID to skip the name lookup) in .env.local.
 * With no key, returns 503 and the client falls back to the phone's built-in voice.
 */
const CARTESIA = "https://api.cartesia.ai";
const VERSION = "2025-04-16";
let cachedVoiceId: string | null = null;

async function voiceId(key: string): Promise<string> {
  if (process.env.CARTESIA_VOICE_ID) return process.env.CARTESIA_VOICE_ID;
  if (cachedVoiceId) return cachedVoiceId;
  const want = (process.env.CARTESIA_VOICE || "Chris").toLowerCase();
  let url: string | null = `${CARTESIA}/voices/?limit=100`;
  while (url) {
    const r = await fetch(url, { headers: { "X-API-Key": key, "Cartesia-Version": VERSION } });
    if (!r.ok) throw new Error(`voices ${r.status}`);
    const j = (await r.json()) as { data?: { id: string; name: string; is_owner?: boolean }[]; has_more?: boolean; next_page?: string } | { id: string; name: string }[];
    const list = Array.isArray(j) ? j : j.data ?? [];
    const hit = list.find((v) => v.name.toLowerCase() === want) ?? list.find((v) => v.name.toLowerCase().includes(want));
    if (hit) { cachedVoiceId = hit.id; return hit.id; }
    url = !Array.isArray(j) && j.has_more && j.next_page ? `${CARTESIA}/voices/?limit=100&starting_after=${j.next_page}` : null;
  }
  throw new Error(`no Cartesia voice named "${process.env.CARTESIA_VOICE || "Chris"}"`);
}

export async function POST(req: Request) {
  const key = process.env.CARTESIA_API_KEY;
  if (!key) return new Response("no CARTESIA_API_KEY", { status: 503 });
  try {
    const { text } = (await req.json()) as { text?: string };
    const transcript = String(text ?? "").slice(0, 1200);
    if (!transcript.trim()) return new Response("empty", { status: 400 });
    const id = await voiceId(key);
    const r = await fetch(`${CARTESIA}/tts/bytes`, {
      method: "POST",
      headers: { "X-API-Key": key, "Cartesia-Version": VERSION, "content-type": "application/json" },
      body: JSON.stringify({
        model_id: process.env.CARTESIA_MODEL || "sonic-2",
        transcript,
        voice: { mode: "id", id },
        language: "en",
        output_format: { container: "mp3", bit_rate: 128000, sample_rate: 44100 },
      }),
    });
    if (!r.ok) return new Response(`cartesia ${r.status}: ${(await r.text()).slice(0, 200)}`, { status: 502 });
    return new Response(r.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    console.error("[tts]", e);
    return new Response(String((e as Error).message || e), { status: 500 });
  }
}
