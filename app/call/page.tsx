"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Plan, Watch } from "@/lib/guide";

type Phase = "setup" | "planning" | "guiding" | "done";
type Point = NonNullable<Watch["point"]>;

// Minimal typing for the browser's speech recognition (webkit prefix on Safari/Chrome).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const WATCH_EVERY_MS = 2500;

// Sounds a tradesperson hears without looking: a rising chime when a step is done, a low buzz on a mistake,
// three sharp beeps for anything unsafe. Plus a buzz in the hand where the phone can vibrate.
let audioCtx: AudioContext | null = null;
function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.18) {
  if (typeof window === "undefined") return;
  const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctx = W.AudioContext ?? W.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = audioCtx ?? new Ctx();
  const t0 = audioCtx.currentTime + start;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function cue(kind: "good" | "bad" | "danger") {
  if (kind === "good") {
    tone(660, 0, 0.14);
    tone(990, 0.12, 0.22);
  } else if (kind === "bad") {
    tone(180, 0, 0.32, "sawtooth", 0.12);
    navigator.vibrate?.(200);
  } else {
    tone(880, 0, 0.12, "square", 0.14);
    tone(880, 0.18, 0.12, "square", 0.14);
    tone(880, 0.36, 0.12, "square", 0.14);
    navigator.vibrate?.([150, 80, 150, 80, 300]);
  }
}

const AIM: Record<string, { arrow: string; words: string; pos: string }> = {
  closer: { arrow: "⤢", words: "Move closer", pos: "inset-0 m-auto h-40 w-40" },
  farther: { arrow: "⤡", words: "Back up", pos: "inset-0 m-auto h-40 w-40" },
  left: { arrow: "←", words: "Move left", pos: "left-3 top-1/2 -translate-y-1/2" },
  right: { arrow: "→", words: "Move right", pos: "right-3 top-1/2 -translate-y-1/2" },
  up: { arrow: "↑", words: "Move up", pos: "left-1/2 top-40 -translate-x-1/2" },
  down: { arrow: "↓", words: "Move down", pos: "left-1/2 bottom-72 -translate-x-1/2" },
};

export default function CallPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const recentRef = useRef<string[]>([]);
  const startedAt = useRef<number>(0);

  const [phase, setPhase] = useState<Phase>("setup");
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [task, setTask] = useState("My water cooler isn't getting cold. Teach me to check it.");
  const [scanLabel, setScanLabel] = useState(true);
  const [teach, setTeach] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [live, setLive] = useState(false);
  const [current, setCurrent] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [safety, setSafety] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<"good" | "bad" | "danger" | null>(null);
  const [aim, setAim] = useState<string | null>(null);

  // ── Camera ────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamOn(true);
      setCamError(null);
    } catch {
      setCamError("Allow the camera so your pro can see what you see.");
    }
  }, []);

  useEffect(() => {
    startCamera();
  }, [startCamera]);

  const capture = useCallback((): string | null => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return null;
    const w = Math.min(768, v.videoWidth);
    const h = Math.round((v.videoHeight / v.videoWidth) * w);
    c.width = w;
    c.height = h;
    c.getContext("2d")?.drawImage(v, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.6).split(",")[1] ?? null;
  }, []);

  // ── Voice out ─────────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    setCaption(text);
    recentRef.current = [...recentRef.current, text].slice(-4);
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((x) => /en-US/.test(x.lang) && /Daniel|Alex|Aaron|Fred|Google US English|Male/i.test(x.name)) ?? voices.find((x) => /en/.test(x.lang));
    if (v) u.voice = v;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
  }, []);

  // ── Plan ──────────────────────────────────────────────────────────────────
  const begin = useCallback(async () => {
    setError(null);
    setPhase("planning");
    // Unlock speech on iOS with a silent utterance inside the tap.
    try {
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(" "));
    } catch {}
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, frame: scanLabel ? capture() : null }),
      });
      const data = (await res.json()) as { plan?: Plan; live?: boolean; error?: string };
      if (!data.plan) throw new Error(data.error ?? "no plan");
      setPlan(data.plan);
      setLive(!!data.live);
      setCurrent(0);
      setMistakes([]);
      recentRef.current = [];
      startedAt.current = Date.now();
      setPhase("guiding");
      speak(`${data.plan.intro} Step one: ${data.plan.steps[0].instruction}`);
    } catch {
      setError("Your pro couldn't load that job. Try again.");
      setPhase("setup");
    }
  }, [task, scanLabel, capture, speak]);

  // ── Watch loop ────────────────────────────────────────────────────────────
  const tick = useCallback(
    async (userSaid: string | null = null) => {
      if (!plan || busy.current) return;
      // Let Ray finish a sentence before looking again (a question always goes through).
      if (!userSaid && typeof window !== "undefined" && window.speechSynthesis?.speaking) return;
      busy.current = true;
      try {
        const res = await fetch("/api/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ frame: capture(), task, plan, current, teach, recent: recentRef.current, userSaid }),
        });
        const w = (await res.json()) as Watch & { error?: string };
        if (w.error) return;
        setPoint(w.point);
        setAim(w.aim);
        if (w.safety) {
          setFlash("danger");
          cue("danger");
        }
        setSafety(w.safety);
        if (w.mistake) {
          setMistakes((m) => [...m, w.mistake as string]);
          setFlash("bad");
          cue("bad");
        }
        if (w.say && (userSaid || !window.speechSynthesis?.speaking)) speak(w.say);
        else if (w.safety) speak(w.safety);
        if (w.stepDone) {
          setFlash("good");
          cue("good");
          if (current + 1 >= plan.steps.length) {
            setPhase("done");
          } else {
            setCurrent((c) => c + 1);
          }
        }
      } catch {
        // The next tick tries again.
      } finally {
        busy.current = false;
      }
    },
    [plan, capture, task, current, teach, speak]
  );

  useEffect(() => {
    if (phase !== "guiding") return;
    const id = setInterval(() => tick(), WATCH_EVERY_MS);
    return () => clearInterval(id);
  }, [phase, tick]);

  useEffect(() => {
    if (phase !== "guiding") return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "done") {
      setPoint(null);
      setSafety(null);
      speak("That's the job. Clean work. I logged every step to your skills.");
    }
  }, [phase, speak]);

  // ── Voice in (push to talk) ───────────────────────────────────────────────
  const listen = useCallback(
    (forTask = false) => {
      const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
      const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
      if (!Ctor) {
        setError("Voice isn't available in this browser. Type instead.");
        return;
      }
      window.speechSynthesis?.cancel();
      const r = new Ctor();
      r.lang = "en-US";
      r.interimResults = false;
      r.continuous = false;
      r.onresult = (e) => {
        const text = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
        if (!text) return;
        setHeard(text);
        if (forTask) setTask(text);
        else tick(text);
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      setListening(true);
      r.start();
    },
    [tick]
  );

  // ── Pointing: map the coach's image coordinates onto the cover-fitted video ─
  const pointStyle = (() => {
    const v = videoRef.current;
    const s = stageRef.current;
    if (!point || !v || !s || !v.videoWidth) return null;
    const ew = s.clientWidth;
    const eh = s.clientHeight;
    const scale = Math.max(ew / v.videoWidth, eh / v.videoHeight);
    const dw = v.videoWidth * scale;
    const dh = v.videoHeight * scale;
    const left = (ew - dw) / 2 + Math.min(Math.max(point.x, 0), 1) * dw;
    const top = (eh - dh) / 2 + Math.min(Math.max(point.y, 0), 1) * dh;
    return { left, top };
  })();

  const step = plan?.steps[current];
  const mm = String(Math.floor(elapsed / 60));
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <main ref={stageRef} className="fixed inset-0 overflow-hidden bg-black text-white select-none">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/80" />

      {/* The pro, like a FaceTime picture-in-picture */}
      <div className="absolute left-4 top-4 flex items-center gap-3">
        <div className={`relative grid h-14 w-14 place-items-center rounded-full bg-[#FF6B1A] text-lg font-bold ${speaking ? "ring-4 ring-[#FF6B1A]/50 animate-pulse" : ""}`}>RJ</div>
        <div className="leading-tight">
          <div className="font-semibold">Ray, journeyman</div>
          <div className="text-xs text-white/70">
            {phase === "guiding" ? (speaking ? "Talking…" : "Watching") : "Ride Along"}
            {phase !== "setup" && !live ? " · practice mode" : ""}
          </div>
        </div>
      </div>
      {phase === "guiding" && (
        <div className="absolute right-4 top-5 rounded-full bg-black/50 px-3 py-1 text-sm tabular-nums">● {mm}:{ss}</div>
      )}

      {/* Product read from the label */}
      {plan && phase === "guiding" && (
        <div className="absolute left-4 top-20 max-w-[70%] rounded-2xl bg-black/50 px-3 py-2 text-xs text-white/85 backdrop-blur">
          <span className="font-semibold text-white">{plan.product.name}</span>
          {plan.product.model ? ` · Model ${plan.product.model}` : ""}
          {plan.product.serial ? ` · ${plan.product.serial}` : ""}
        </div>
      )}

      {/* The pro points at the part */}
      {phase === "guiding" && pointStyle && point && (
        <div className="pointer-events-none absolute transition-all duration-500" style={{ left: pointStyle.left, top: pointStyle.top }}>
          <div className="absolute -left-16 -top-16 h-32 w-32 rounded-full border-[6px] border-[#FF6B1A] animate-ping opacity-50" />
          <div className="absolute -left-14 -top-14 h-28 w-28 rounded-full border-[6px] border-[#FF6B1A] shadow-[0_0_30px_#FF6B1A]" />
          <div className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-[#FF6B1A]" />
          <div className="absolute left-16 -top-6 whitespace-nowrap rounded-2xl bg-[#FF6B1A] px-4 py-2 text-xl font-extrabold shadow-xl">{point.label}</div>
        </div>
      )}

      {/* Where to move the camera */}
      {phase === "guiding" && aim && AIM[aim] && (
        <div className={`pointer-events-none absolute grid place-items-center ${AIM[aim].pos}`}>
          <div className="grid h-24 w-24 animate-bounce place-items-center rounded-full bg-white/90 text-6xl font-black text-black shadow-2xl">{AIM[aim].arrow}</div>
          <div className="mt-2 rounded-full bg-black/70 px-3 py-1 text-lg font-bold">{AIM[aim].words}</div>
        </div>
      )}

      {/* A flash you see out of the corner of your eye */}
      {flash && (
        <div
          key={flash + current + mistakes.length}
          onAnimationEnd={() => setFlash(null)}
          className={`pointer-events-none absolute inset-0 animate-[flash_1.2s_ease-out_forwards] border-[14px] ${flash === "good" ? "border-[#22C55E] bg-[#22C55E]/20" : flash === "bad" ? "border-amber-400 bg-amber-400/15" : "border-red-600 bg-red-600/25"}`}
        >
          <div className="absolute inset-0 grid place-items-center text-9xl">{flash === "good" ? "✓" : flash === "bad" ? "✋" : "⚠️"}</div>
        </div>
      )}

      {/* Safety */}
      {safety && phase === "guiding" && (
        <div className="absolute inset-x-4 top-32 flex items-center gap-3 rounded-3xl bg-red-600 px-4 py-3 text-xl font-extrabold shadow-2xl animate-pulse"><span className="text-4xl">⚠️</span>{safety}</div>
      )}

      {/* SETUP */}
      {phase === "setup" && (
        <div className="absolute inset-x-0 bottom-0 p-5 pb-8">
          <h1 className="text-3xl font-bold leading-tight">What are we working on?</h1>
          <p className="mt-1 text-white/70">Point your camera at it. Your pro sees what you see.</p>
          <div className="mt-4 flex gap-2">
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="min-w-0 flex-1 rounded-2xl bg-white/15 px-4 py-3 text-lg outline-none placeholder:text-white/50 backdrop-blur"
              placeholder="e.g. Changing a water filter"
            />
            <button onClick={() => listen(true)} className={`rounded-2xl px-4 text-xl ${listening ? "bg-[#FF6B1A]" : "bg-white/15"}`} aria-label="Say it">
              🎙️
            </button>
          </div>
          <div className="mt-3 flex gap-2 text-sm">
            <button onClick={() => setScanLabel((s) => !s)} className={`rounded-full px-4 py-2 font-semibold ${scanLabel ? "bg-white text-black" : "bg-white/15"}`}>
              {scanLabel ? "✓ " : ""}Read the label
            </button>
            <button onClick={() => setTeach((t) => !t)} className={`rounded-full px-4 py-2 font-semibold ${teach ? "bg-white text-black" : "bg-white/15"}`}>
              {teach ? "✓ " : ""}Teach me
            </button>
          </div>
          {(camError || error) && <p className="mt-3 text-red-300">{camError ?? error}</p>}
          <button onClick={begin} className="mt-5 h-16 w-full rounded-full bg-[#FF6B1A] text-xl font-bold">
            Call my pro
          </button>
        </div>
      )}

      {/* PLANNING */}
      {phase === "planning" && (
        <div className="absolute inset-x-0 bottom-0 p-6 pb-10 text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-[#FF6B1A]" />
          <div className="text-2xl font-bold">Ray is looking at your job…</div>
          <div className="mt-1 text-white/70">{scanLabel ? "Reading the label and planning the steps" : "Planning the steps"}</div>
        </div>
      )}

      {/* GUIDING */}
      {phase === "guiding" && plan && step && (
        <div className="absolute inset-x-0 bottom-0 p-5 pb-7">
          {caption && speaking && <div className="mb-3 line-clamp-2 rounded-2xl bg-black/60 px-4 py-2 text-base leading-snug text-white/95 backdrop-blur">{caption}</div>}
          <div className="flex items-center gap-4">
            <div className="grid h-20 w-20 flex-none place-items-center rounded-3xl bg-white/15 text-5xl backdrop-blur">{step.icon}</div>
            <div className="min-w-0">
              <div className="text-sm font-bold uppercase tracking-wider text-[#FFB38A]">
                {current + 1} / {plan.steps.length}
              </div>
              <div className="text-3xl font-extrabold leading-tight">{step.title}</div>
            </div>
          </div>
          <div className="mt-3 flex h-2 gap-1">
            {plan.steps.map((_, i) => (
              <div key={i} className={`flex-1 rounded-full ${i < current ? "bg-[#22C55E]" : i === current ? "bg-[#FF6B1A]" : "bg-white/25"}`} />
            ))}
          </div>
          <div className="mt-5 grid grid-cols-4 gap-3">
            <button onClick={() => { const last = recentRef.current[recentRef.current.length - 1]; if (last) speak(last); }} className="grid h-20 place-items-center rounded-3xl bg-white/15 text-3xl backdrop-blur" aria-label="Repeat">
              🔁
            </button>
            <button onClick={() => listen(false)} className={`col-span-2 grid h-20 place-items-center rounded-3xl text-3xl ${listening ? "bg-[#FF6B1A] animate-pulse" : "bg-white text-black"}`} aria-label="Ask Ray">
              {listening ? "👂" : "🎙️"}
            </button>
            <button onClick={() => { setFlash("good"); cue("good"); if (current + 1 >= plan.steps.length) setPhase("done"); else setCurrent((c) => c + 1); }} className="grid h-20 place-items-center rounded-3xl bg-[#22C55E] text-3xl" aria-label="Done with this step">
              ✓
            </button>
          </div>
          <button onClick={() => setShowSteps(true)} className="mt-3 w-full text-center text-sm text-white/60">All steps</button>
        </div>
      )}

      {/* Steps drawer */}
      {showSteps && plan && (
        <div className="absolute inset-0 bg-black/70 p-5 pt-16 backdrop-blur" onClick={() => setShowSteps(false)}>
          <div className="text-2xl font-bold">The job</div>
          <div className="mt-1 text-white/70">Tools: {plan.tools.join(", ")}</div>
          <ol className="mt-4 space-y-3">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className={`mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full text-sm font-bold ${i < current ? "bg-[#22C55E]" : i === current ? "bg-[#FF6B1A]" : "bg-white/20"}`}>{i < current ? "✓" : i + 1}</span>
                <div>
                  <div className="font-semibold">{s.title}</div>
                  <div className="text-sm text-white/70">{s.why}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* DONE */}
      {phase === "done" && plan && (
        <div className="absolute inset-0 overflow-y-auto bg-[#0E0E0E] p-6 pt-16">
          <div className="text-sm font-semibold uppercase tracking-wider text-[#22C55E]">Job complete</div>
          <h1 className="mt-1 text-4xl font-bold leading-tight">{plan.product.name}</h1>
          <div className="mt-2 text-white/70">
            {plan.steps.length} steps · {mm}:{ss} · {plan.trade}
          </div>
          <div className="mt-6 rounded-3xl bg-[#FF6B1A] p-5">
            <div className="text-sm font-semibold opacity-90">TradesQuest</div>
            <div className="text-4xl font-bold">+{plan.steps.length * 40} XP</div>
            <div className="text-sm opacity-90">Verified on camera by your pro</div>
          </div>
          <h2 className="mt-7 text-xl font-bold">Skills you practiced</h2>
          <ul className="mt-2 divide-y divide-white/10">
            {plan.steps.map((s, i) => (
              <li key={i} className="flex justify-between py-3">
                <span>{s.skill}</span>
                <span className="text-[#22C55E]">✓</span>
              </li>
            ))}
          </ul>
          <h2 className="mt-6 text-xl font-bold">Caught and fixed</h2>
          {mistakes.length ? (
            <ul className="mt-2 space-y-1 text-white/80">
              {mistakes.map((m, i) => (
                <li key={i}>• {m}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-white/70">No mistakes. Clean job.</p>
          )}
          <div className="mt-8 grid gap-3 pb-10">
            <button onClick={() => { setPhase("setup"); setPlan(null); setCaption(null); }} className="h-16 rounded-full bg-white text-lg font-bold text-black">
              Start another job
            </button>
            <button className="h-16 rounded-full bg-white/10 text-lg font-semibold">Call a real pro</button>
          </div>
        </div>
      )}
    </main>
  );
}
