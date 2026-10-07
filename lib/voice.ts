"use client";
/**
 * Ray's voice on the client. Tries the cloned Cartesia voice via /api/tts; if that isn't available,
 * falls back to the phone's built-in speech so the demo never goes silent.
 */
let audio: HTMLAudioElement | null = null;
let speakingFlag = false;
let seq = 0;

export function isSpeaking(): boolean {
  return speakingFlag || (typeof window !== "undefined" && !!window.speechSynthesis?.speaking);
}

export function stopSpeaking() {
  seq++;
  if (audio) { audio.pause(); audio.src = ""; audio = null; }
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  speakingFlag = false;
}

function fallback(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.02;
  const voices = window.speechSynthesis.getVoices();
  const pick = voices.find((v) => /Samantha|Daniel|Google US English|Karen|Alex/i.test(v.name)) ?? voices[0];
  if (pick) u.voice = pick;
  window.speechSynthesis.speak(u);
}

export async function speak(text: string): Promise<void> {
  if (!text?.trim()) return;
  stopSpeaking();
  const my = ++seq;
  speakingFlag = true;
  try {
    const r = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (my !== seq) return; // superseded
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob();
    if (my !== seq) return;
    const url = URL.createObjectURL(blob);
    audio = new Audio(url);
    audio.onended = () => { if (my === seq) speakingFlag = false; URL.revokeObjectURL(url); };
    audio.onerror = () => { if (my === seq) speakingFlag = false; };
    await audio.play();
  } catch {
    if (my !== seq) return;
    speakingFlag = false;
    fallback(text);
  }
}
