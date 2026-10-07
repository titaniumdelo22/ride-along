"use client";
/**
 * Ray's voice on the client. Plays the cloned Cartesia voice via /api/tts through ONE reused <audio> element.
 * iPhone Safari only lets audio play if that element was first started inside a tap, so we "unlock" it on the
 * first touch anywhere on the page. If Cartesia fails, falls back to the phone's built-in speech.
 */
let audio: HTMLAudioElement | null = null;
let unlocked = false;
let speakingFlag = false;
let seq = 0;

// 0.1 s of silence, used to unlock the audio element inside a user gesture.
const SILENT = "/silence.wav";

function el(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio();
    audio.setAttribute("playsinline", "");
    audio.preload = "auto";
  }
  return audio;
}

export function unlockAudio() {
  if (unlocked || typeof window === "undefined") return;
  const a = el();
  a.src = SILENT;
  a.play().then(() => { unlocked = true; }).catch(() => {});
  // also wake speechSynthesis on iOS
  try { window.speechSynthesis?.speak(new SpeechSynthesisUtterance(" ")); } catch {}
}

if (typeof window !== "undefined") {
  // keep trying on every tap until it's unlocked (some taps don't count as a gesture on iOS)
  const tryUnlock = () => { if (!unlocked) unlockAudio(); };
  window.addEventListener("touchend", tryUnlock, { passive: true });
  window.addEventListener("click", tryUnlock);
}

export function voiceUnlocked() { return unlocked; }

export function isSpeaking(): boolean {
  return speakingFlag || (typeof window !== "undefined" && !!window.speechSynthesis?.speaking);
}

export function stopSpeaking() {
  seq++;
  if (audio) audio.pause();
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  speakingFlag = false;
}

type Hooks = { onStart?: () => void; onEnd?: () => void };

function fallback(text: string, hooks?: Hooks) {
  if (typeof window === "undefined" || !window.speechSynthesis) { hooks?.onEnd?.(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.onstart = () => hooks?.onStart?.();
  u.onend = () => hooks?.onEnd?.();
  u.onerror = () => hooks?.onEnd?.();
  u.rate = 1.02;
  const voices = window.speechSynthesis.getVoices();
  const pick = voices.find((v) => /Samantha|Daniel|Google US English|Karen|Alex/i.test(v.name)) ?? voices[0];
  if (pick) u.voice = pick;
  window.speechSynthesis.speak(u);
}

export async function speak(text: string, hooks?: Hooks): Promise<void> {
  if (!text?.trim()) { hooks?.onEnd?.(); return; }
  stopSpeaking();
  const my = ++seq;
  speakingFlag = true;
  try {
    const r = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (my !== seq) return;
    if (!r.ok) throw new Error(await r.text());
    const blob = await r.blob();
    if (my !== seq) return;
    const a = el();
    const url = URL.createObjectURL(blob);
    a.onended = () => { if (my === seq) speakingFlag = false; URL.revokeObjectURL(url); hooks?.onEnd?.(); };
    a.onerror = () => { if (my === seq) speakingFlag = false; hooks?.onEnd?.(); };
    a.onplaying = () => hooks?.onStart?.();
    a.src = url;
    await a.play();
  } catch {
    if (my !== seq) return;
    speakingFlag = false;
    fallback(text, hooks);
  }
}
