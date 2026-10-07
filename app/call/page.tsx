"use client";

import confetti from "canvas-confetti";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Kit, Plan, Report, Watch } from "@/lib/guide";
import type { Identify } from "@/lib/identify";

type Phase = "setup" | "identify" | "planning" | "loadout" | "guiding" | "done";
type Level = "newbie" | "intermediate" | "advanced";
const LEVEL_PICKS: { id: Level; icon: string; name: string; hint: string }[] = [
  { id: "newbie", icon: "🐣", name: "Newbie", hint: "Small steps" },
  { id: "intermediate", icon: "🔧", name: "Intermediate", hint: "Normal pace" },
  { id: "advanced", icon: "🏆", name: "Advanced", hint: "Pro speed" },
];
type Point = NonNullable<Watch["point"]>;

// Minimal typing for the browser's speech recognition (webkit prefix on Safari/Chrome).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

// Hands-free: short things people say instead of tapping. Matched against the whole (trimmed) phrase.
const SAY = {
  next: ["next", "next step", "done", "i'm done", "im done", "all done", "finished", "got it", "did it", "i did it", "it's done", "its done", "that's done", "thats done", "check", "okay next"],
  back: ["back", "go back", "previous", "previous step", "last step", "go back a step", "back one step", "step back", "go back one"],
  repeat: ["repeat", "repeat that", "again", "say that again", "say it again", "what", "come again", "what did you say", "huh", "one more time"],
  fix: ["fix it", "let's fix it", "lets fix it", "let's go", "lets go", "start", "yes", "yeah", "let's do it", "lets do it", "help me fix it", "fix it with ray", "okay let's go"],
  look: ["look again", "scan again", "try again", "look", "scan"],
  go: ["let's go", "lets go", "ready", "i'm ready", "im ready", "start", "go", "yes", "yeah", "let's do it", "lets do it", "okay let's go", "got it", "got everything"],
};
function said(raw: string, phrases: string[]): boolean {
  const t = raw
    .toLowerCase()
    .replace(/[^a-z' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(ok|okay|alright|all right|hey ray|ray|so|um|uh)\s+/, "")
    .replace(/\s+(please|ray|now|then)$/, "");
  return phrases.includes(t);
}

const WATCH_EVERY_MS = 2500;
const ORANGE = "#FF6B1A";

// ── The game: levels, missions, badges ───────────────────────────────────────

const LEVELS = [
  { name: "Apprentice I", at: 0 },
  { name: "Apprentice II", at: 300 },
  { name: "Apprentice III", at: 700 },
  { name: "Journeyman I", at: 1200 },
  { name: "Journeyman II", at: 1800 },
  { name: "Master", at: 2600 },
];
function levelOf(xp: number) {
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (xp >= LEVELS[k].at) i = k;
  const base = LEVELS[i].at;
  const next = LEVELS[i + 1]?.at ?? base + 1000;
  return { i, name: LEVELS[i].name, base, next, pct: Math.min(1, (xp - base) / (next - base)) };
}

const MISSIONS = [
  { icon: "💧", title: "Out-of-order water cooler", task: "This water cooler has an out of order sign. I know nothing about it. Help me fix it.", xp: 400, stars: 2 },
  { icon: "🚰", title: "Fix a dripping faucet", task: "My kitchen faucet drips. Teach me to fix it.", xp: 350, stars: 2 },
  { icon: "⚡", title: "Dead outlet: reset the GFCI", task: "An outlet stopped working. Teach me to check and reset the GFCI safely.", xp: 200, stars: 1 },
  { icon: "🌬️", title: "Swap an AC filter", task: "Teach me to change the air filter on my furnace or AC.", xp: 150, stars: 1 },
];

const BADGES = {
  eagle: { icon: "🦅", name: "Eagle Eye", why: "Read the data plate" },
  safety: { icon: "🛡️", name: "Safety First", why: "Made it safe before touching it" },
  asked: { icon: "🧠", name: "Asked a Pro", why: "Asked a question on the job" },
  onfire: { icon: "🔥", name: "On Fire", why: "3 clean steps in a row" },
  clean: { icon: "🎯", name: "Zero Mistakes", why: "A whole job, no mistakes" },
  done: { icon: "🏁", name: "Job Done", why: "Finished the job" },
} as const;
type BadgeId = keyof typeof BADGES;

// ── Sounds a tradesperson hears without looking ──────────────────────────────

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
function cue(kind: "good" | "bad" | "danger" | "coin" | "badge" | "level") {
  if (kind === "good") {
    tone(660, 0, 0.14);
    tone(990, 0.12, 0.22);
  } else if (kind === "coin") {
    tone(988, 0, 0.08, "square", 0.08);
    tone(1319, 0.08, 0.25, "square", 0.08);
  } else if (kind === "badge") {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle", 0.14));
  } else if (kind === "level") {
    [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.3, "triangle", 0.16));
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
function burst(big = false) {
  confetti({ particleCount: big ? 180 : 70, spread: big ? 110 : 70, origin: { y: big ? 0.6 : 0.3 }, colors: [ORANGE, "#22C55E", "#FFD23F", "#FFFFFF"] });
}

const AIM: Record<string, { arrow: string; words: string; pos: string }> = {
  closer: { arrow: "⤢", words: "Move closer", pos: "inset-0 m-auto h-40 w-40" },
  farther: { arrow: "⤡", words: "Back up", pos: "inset-0 m-auto h-40 w-40" },
  left: { arrow: "←", words: "Move left", pos: "left-3 top-1/2 -translate-y-1/2" },
  right: { arrow: "→", words: "Move right", pos: "right-3 top-1/2 -translate-y-1/2" },
  up: { arrow: "↑", words: "Move up", pos: "left-1/2 top-44 -translate-x-1/2" },
  down: { arrow: "↓", words: "Move down", pos: "left-1/2 bottom-80 -translate-x-1/2" },
};

function readXp(): number {
  try {
    const v = Number(localStorage.getItem("ra.xp"));
    return Number.isFinite(v) && v > 0 ? v : 620;
  } catch {
    return 620;
  }
}

export default function CallPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const recentRef = useRef<string[]>([]);
  const questionsRef = useRef<string[]>([]);
  const redoneRef = useRef<string[]>([]);
  const clearedRef = useRef<Set<number>>(new Set());
  const jobRef = useRef(0);
  const handsFreeRef = useRef(true);
  const earWantedRef = useRef(false);
  const earRef = useRef<Recognition | null>(null);
  const talkingRef = useRef(false);
  const uttRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onHeardRef = useRef<(text: string) => void>(() => {});
  const pendingAsk = useRef<string | null>(null);
  const voiceAt = useRef(0); // last time we heard the learner start talking
  const tickRef = useRef<(userSaid: string | null) => void>(() => {});
  // Steps written ahead while they read the "What is this?" screen.
  const aheadRef = useRef<{ task: string; level: Level; steps: Promise<{ plan?: Plan; error?: string }> } | null>(null);
  const startedAt = useRef<number>(0);
  const stepMistake = useRef(false);
  const earned = useRef<Set<BadgeId>>(new Set());
  const xpRef = useRef(620);
  const comboRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("setup");
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [mission, setMission] = useState(0);
  const [task, setTask] = useState(MISSIONS[0].task);
  const [scanLabel, setScanLabel] = useState(true);
  const [teach, setTeach] = useState(true);
  const [level, setLevel] = useState<Level>("newbie");
  const [gear, setGear] = useState<Set<number>>(new Set());
  const [kit, setKit] = useState<Kit | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planFailed, setPlanFailed] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [reportState, setReportState] = useState<"idle" | "loading" | "error">("idle");
  const [shared, setShared] = useState<string | null>(null);
  // Hands-free, like a phone call: the mic opens whenever Ray stops talking.
  const [handsFree, setHandsFree] = useState(true);
  const [earOn, setEarOn] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [found, setFound] = useState<Identify | null>(null);
  const [looking, setLooking] = useState(false);
  const [snap, setSnap] = useState<{ src: string; w: number; h: number } | null>(null);
  const [live, setLive] = useState(false);
  const [current, setCurrent] = useState(0);
  const [caption, setCaption] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [safety, setSafety] = useState<string | null>(null);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<"good" | "bad" | "danger" | null>(null);
  const [aim, setAim] = useState<string | null>(null);
  // The game
  const [xp, setXp] = useState(620);
  const [jobXp, setJobXp] = useState(0);
  const [combo, setCombo] = useState(0);
  const [popup, setPopup] = useState<{ amount: number; lines: string[]; key: number } | null>(null);
  const [toasts, setToasts] = useState<BadgeId[]>([]);
  const [levelUp, setLevelUp] = useState<string | null>(null);
  const [badges, setBadges] = useState<BadgeId[]>([]);

  useEffect(() => {
    xpRef.current = readXp();
    setXp(xpRef.current);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("ra.xp", String(xp));
    } catch {}
  }, [xp]);

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

  // ── Voice in, hands-free (the mic is closed while Ray talks so he doesn't hear himself) ─
  const stopEar = useCallback(() => {
    const r = earRef.current;
    earRef.current = null;
    setEarOn(false);
    try {
      r?.abort();
    } catch {}
  }, []);

  const startEar = useCallback(function start() {
    if (!handsFreeRef.current || !earWantedRef.current || earRef.current || talkingRef.current) return;
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    const opened = Date.now();
    r.onresult = (e) => {
      const results = Array.from(e.results);
      voiceAt.current = Date.now();
      if (!results.length || !results[results.length - 1].isFinal) return; // still talking
      const text = results.map((x) => x[0].transcript).join(" ").trim();
      if (text && !talkingRef.current) onHeardRef.current(text);
    };
    r.onerror = (e) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        handsFreeRef.current = false;
        setHandsFree(false);
      }
    };
    r.onend = () => {
      if (earRef.current !== r) return;
      earRef.current = null;
      setEarOn(false);
      // Reopen right away; back off if the browser keeps closing it instantly.
      setTimeout(start, Date.now() - opened < 1000 ? 1500 : 250);
    };
    earRef.current = r;
    setEarOn(true);
    try {
      r.start();
    } catch {
      earRef.current = null;
      setEarOn(false);
    }
  }, []);

  // ── Voice out ─────────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    setCaption(text);
    setHeard(null);
    recentRef.current = [...recentRef.current, text].slice(-4);
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    talkingRef.current = true;
    stopEar();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    uttRef.current = u;
    const finish = () => {
      if (uttRef.current !== u) return;
      uttRef.current = null;
      talkingRef.current = false;
      setSpeaking(false);
      setTimeout(startEar, 350);
    };
    // Some phones never fire onend: don't leave the mic closed forever.
    setTimeout(() => {
      if (uttRef.current === u && !window.speechSynthesis.speaking) finish();
    }, 2500 + text.length * 90);
    u.rate = 1.03;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find((x) => /en-US/.test(x.lang) && /Daniel|Alex|Aaron|Fred|Google US English|Male/i.test(x.name)) ?? voices.find((x) => /en/.test(x.lang));
    if (v) u.voice = v;
    u.onstart = () => setSpeaking(true);
    u.onend = finish;
    u.onerror = finish;
    window.speechSynthesis.speak(u);
  }, [stopEar, startEar]);

  // ── The game's moments ────────────────────────────────────────────────────
  const award = useCallback((amount: number, lines: string[]) => {
    const before = xpRef.current;
    const after = before + amount;
    xpRef.current = after;
    setXp(after);
    const b = levelOf(after);
    if (b.i > levelOf(before).i) {
      setTimeout(() => {
        setLevelUp(b.name);
        cue("level");
        burst(true);
      }, 900);
    }
    setJobXp((j) => j + amount);
    setPopup({ amount, lines, key: Date.now() });
    cue("coin");
  }, []);

  const unlock = useCallback(
    (id: BadgeId) => {
      if (earned.current.has(id)) return;
      earned.current.add(id);
      setBadges((b) => [...b, id]);
      setToasts((t) => [...t, id]);
      setTimeout(() => {
        cue("badge");
        burst();
      }, 300);
      award(25, [`${BADGES[id].icon} ${BADGES[id].name}`]);
    },
    [award]
  );

  // Show one badge toast at a time.
  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => setToasts((t) => t.slice(1)), 2600);
    return () => clearTimeout(id);
  }, [toasts]);
  useEffect(() => {
    if (!levelUp) return;
    const id = setTimeout(() => setLevelUp(null), 3200);
    return () => clearTimeout(id);
  }, [levelUp]);

  const stepCleared = useCallback(
    (index: number, total: number) => {
      setPoint(null);
      setAim(null);
      if (clearedRef.current.has(index)) {
        // A step they went back to: no second payout, just move on.
        cue("good");
        if (index + 1 >= total) setTimeout(() => setPhase("done"), 1200);
        else setCurrent(index + 1);
        return;
      }
      clearedRef.current.add(index);
      const clean = !stepMistake.current;
      const next = clean ? comboRef.current + 1 : 0;
      comboRef.current = next;
      setCombo(next);
      const lines = ["Step done +50"];
      let amount = 50;
      if (clean) {
        lines.push("Clean +25");
        amount += 25;
      }
      if (next >= 2) {
        lines.push(`🔥 Combo x${next} +${next * 10}`);
        amount += next * 10;
      }
      award(amount, lines);
      if (next >= 3) setTimeout(() => unlock("onfire"), 1400);
      if (index === 0) setTimeout(() => unlock("safety"), 1600);
      stepMistake.current = false;
      setFlash("good");
      cue("good");
      if (index + 1 >= total) setTimeout(() => setPhase("done"), 1800);
      else setCurrent(index + 1);
    },
    [award, unlock]
  );

  // ── Plan ──────────────────────────────────────────────────────────────────
  const begin = useCallback(async (override?: string, known?: Kit) => {
    setError(null);
    setPhase("planning");
    // Unlock speech and sound on iOS inside the tap.
    try {
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(" "));
      tone(1, 0, 0.01, "sine", 0.0001);
    } catch {}
    const job = ++jobRef.current;
    const body = JSON.stringify({ task: override ?? task, level, frame: scanLabel ? capture() : null });
    const post = (path: string) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body }).then((r) => r.json());
    // Two calls at once: the gear list comes back in seconds, the steps keep cooking while they gear up.
    setPlan(null);
    setPlanFailed(false);
    const ahead = aheadRef.current;
    aheadRef.current = null;
    const steps = ahead && ahead.task === (override ?? task) && ahead.level === level ? ahead.steps : (post("/api/plan") as Promise<{ plan?: Plan; error?: string }>);
    try {
      const data = known ? { kit: known, live } : ((await post("/api/kit")) as { kit?: Kit; live?: boolean; error?: string });
      if (!data.kit) throw new Error(data.error ?? "no kit");
      if (job !== jobRef.current) return;
      const k = data.kit;
      setKit(k);
      setLive(!!data.live);
      setCurrent(0);
      setMistakes([]);
      setBadges([]);
      setJobXp(0);
      setCombo(0);
      setReport(null);
      setReportState("idle");
      setShared(null);
      comboRef.current = 0;
      earned.current = new Set();
      clearedRef.current = new Set();
      stepMistake.current = false;
      recentRef.current = [];
      questionsRef.current = [];
      redoneRef.current = [];
      setGear(new Set());
      setPhase("loadout");
      speak(`Before we start, grab your gear: ${k.tools.map((t) => t.name).join(", ")}.`);
      if (k.product.model) setTimeout(() => unlock("eagle"), 1200);
      steps
        .then((d) => {
          if (job !== jobRef.current) return;
          if (!d.plan) throw new Error(d.error ?? "no plan");
          // Keep what's already on screen (the item and the gear) so nothing jumps.
          // The label read from the steps call wins if the gear call didn't get one.
          setPlan({ ...d.plan, product: k.product.model || !d.plan.product.model ? k.product : d.plan.product, tools: k.tools });
        })
        .catch(() => job === jobRef.current && setPlanFailed(true));
    } catch {
      setError("Your pro couldn't load that job. Try again.");
      setPhase("setup");
    }
  }, [task, level, scanLabel, capture, speak, unlock, live]);

  // ── "What am I looking at?" ───────────────────────────────────────────────
  const lookAt = useCallback(
    async (problem?: string) => {
      setError(null);
      setPhase("identify");
      setFound(null);
      setLooking(true);
      try {
        window.speechSynthesis?.speak(new SpeechSynthesisUtterance(" "));
        tone(1, 0, 0.01, "sine", 0.0001);
      } catch {}
      const frame = capture();
      setSnap(frame && canvasRef.current ? { src: `data:image/jpeg;base64,${frame}`, w: canvasRef.current.width, h: canvasRef.current.height } : null);
      // The mission presets aren't a description of what's in front of them; only send what they typed or said.
      const said = problem ?? (MISSIONS.some((m) => m.task === task) ? "" : task);
      try {
        const res = await fetch("/api/identify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frame, problem: said, level }) });
        const d = (await res.json()) as { result?: Identify; live?: boolean; error?: string };
        if (!d.result) throw new Error(d.error ?? "no result");
        setFound(d.result);
        setLive(d.live !== false);
        speak(d.result.say);
        const m = d.result.missions[0];
        if (m) {
          const steps = fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: m.task, level, frame }) }).then((r) => r.json());
          steps.catch(() => {});
          aheadRef.current = { task: m.task, level, steps };
        }
        award(15, ["🔍 New machine spotted"]);
      } catch {
        setError("Ray couldn't make that out. Get a little closer and try again.");
      } finally {
        setLooking(false);
      }
    },
    [capture, task, level, speak, award]
  );

  const retrySteps = useCallback(() => {
    if (!kit) return;
    const job = jobRef.current;
    setPlanFailed(false);
    fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, level, frame: null }) })
      .then((r) => r.json())
      .then((d: { plan?: Plan }) => {
        if (job !== jobRef.current) return;
        if (!d.plan) throw new Error("no plan");
        setPlan({ ...d.plan, product: kit.product, tools: kit.tools });
      })
      .catch(() => job === jobRef.current && setPlanFailed(true));
  }, [kit, task, level]);

  // Back one step (or jump to any step from the map): no penalty, Ray re-explains it.
  const goTo = useCallback(
    (index: number) => {
      if (!plan || index < 0 || index >= plan.steps.length || index === current) return;
      if (index < current) redoneRef.current = [...redoneRef.current, plan.steps[index].title];
      setCurrent(index);
      setPoint(null);
      setAim(null);
      setSafety(null);
      stepMistake.current = false;
      setShowSteps(false);
      cue("coin");
      const s = plan.steps[index];
      speak(`${index < current ? "No problem, back to" : "Jumping to"} step ${index + 1}, ${s.title}. ${s.instruction}`);
    },
    [plan, current, speak]
  );

  const go = useCallback(() => {
    if (!plan) return;
    startedAt.current = Date.now();
    setPhase("guiding");
    award(10 * plan.tools.length, ["🎒 Geared up"]);
    speak(`${plan.intro} Step one: ${plan.steps[0].instruction}`);
  }, [plan, award, speak]);

  // ── Watch loop ────────────────────────────────────────────────────────────
  const tick = useCallback(
    async (userSaid: string | null = null) => {
      if (!plan) return;
      if (busy.current) {
        if (userSaid) pendingAsk.current = userSaid;
        return;
      }
      // Let Ray finish a sentence before looking again (a question always goes through).
      if (!userSaid && typeof window !== "undefined" && window.speechSynthesis?.speaking) return;
      // ...and never talks over the learner.
      if (!userSaid && Date.now() - voiceAt.current < 2500) return;
      busy.current = true;
      try {
        const res = await fetch("/api/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ frame: capture(), task, level, plan, current, teach, recent: recentRef.current, userSaid }),
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
          stepMistake.current = true;
          comboRef.current = 0;
          setCombo(0);
          setFlash("bad");
          cue("bad");
        }
        const theyreTalking = !userSaid && Date.now() - voiceAt.current < 2500;
        if (w.say && !theyreTalking && (userSaid || !window.speechSynthesis?.speaking)) speak(w.say);
        else if (w.safety) speak(w.safety);
        if (w.stepDone) stepCleared(current, plan.steps.length);
      } catch {
        // The next tick tries again.
      } finally {
        busy.current = false;
        const q = pendingAsk.current;
        if (q) {
          pendingAsk.current = null;
          setTimeout(() => tickRef.current(q), 0);
        }
      }
    },
    [plan, capture, task, level, current, teach, speak, stepCleared]
  );
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // Done with a step (button or "next"): Ray says the next one right away.
  const markDone = useCallback(() => {
    if (!plan) return;
    const next = plan.steps[current + 1];
    stepCleared(current, plan.steps.length);
    if (next) speak(`Nice. Step ${current + 2}: ${next.instruction}`);
  }, [plan, current, stepCleared, speak]);

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

  const writeReport = useCallback(() => {
    if (!plan) return;
    const job = jobRef.current;
    setReportState("loading");
    fetch("/api/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, level, minutes: (Date.now() - startedAt.current) / 60000, mistakes, questions: questionsRef.current, redone: redoneRef.current }),
    })
      .then((r) => r.json())
      .then((d: { report?: Report }) => {
        if (job !== jobRef.current) return;
        if (!d.report) throw new Error("no report");
        setReport(d.report);
        setReportState("idle");
        try {
          const book = JSON.parse(localStorage.getItem("ra.logbook") ?? "[]") as unknown[];
          localStorage.setItem("ra.logbook", JSON.stringify([{ at: new Date().toISOString(), product: plan.product, report: d.report }, ...book].slice(0, 50)));
        } catch {}
      })
      .catch(() => job === jobRef.current && setReportState("error"));
  }, [plan, level, mistakes]);

  const reportText = (): string => {
    if (!plan || !report) return "";
    const p = plan.product;
    return [
      `🛠️ Job report · Ride Along`,
      report.headline,
      `${p.name}${p.model ? ` · model ${p.model}` : ""}${p.serial ? ` · serial ${p.serial}` : ""} · ${new Date().toLocaleDateString()} · ${mm}:${ss}`,
      ``,
      `What I did`,
      report.didWhat,
      ...plan.steps.map((s, i) => `${i + 1}. ${s.title}`),
      ``,
      `What I learned`,
      ...report.learned.map((x) => `• ${x}`),
      ``,
      `How to teach it`,
      ...report.teachBack.map((x, i) => `${i + 1}. ${x}`),
      ...(mistakes.length ? [``, `Caught and fixed`, ...mistakes.map((m) => `• ${m}`)] : []),
      ``,
      `Next time: ${report.nextTime}`,
      `Skills: ${plan.steps.map((s) => s.skill).join(", ")}`,
    ].join("\n");
  };

  const shareReport = async () => {
    const text = reportText();
    if (!text) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Job report", text });
        setShared("Shared");
        return;
      }
    } catch {
      // Cancelled, or sharing isn't allowed here: fall through to copy.
    }
    try {
      await navigator.clipboard.writeText(text);
      setShared("Copied");
    } catch {
      setShared("Couldn't copy");
    }
  };

  useEffect(() => {
    if (phase !== "done") return;
    setPoint(null);
    setSafety(null);
    setAim(null);
    if (mistakes.length === 0) setTimeout(() => unlock("clean"), 600);
    setTimeout(() => unlock("done"), 300);
    burst(true);
    speak("That's the job. Clean work. You just leveled up your skills.");
    writeReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Voice in (push to talk) ───────────────────────────────────────────────
  const listen = useCallback(
    (mode: "ask" | "task" | "identify" = "ask") => {
      const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
      const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
      if (!Ctor) {
        setError("Voice isn't available in this browser. Type instead.");
        return;
      }
      window.speechSynthesis?.cancel();
      stopEar();
      const r = new Ctor();
      r.lang = "en-US";
      r.interimResults = false;
      r.continuous = false;
      r.onresult = (e) => {
        const text = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
        if (!text) return;
        if (mode === "task") setTask(text);
        else if (mode === "identify") {
          setTask(text);
          lookAt(text);
        } else {
          questionsRef.current = [...questionsRef.current, text].slice(-12);
          tick(text);
          unlock("asked");
        }
      };
      r.onend = () => {
        setListening(false);
        setTimeout(startEar, 300);
      };
      r.onerror = () => setListening(false);
      setListening(true);
      r.start();
    },
    [tick, unlock, lookAt, stopEar, startEar]
  );

  // From "What is this?" straight into the job, with the gear list it already found.
  const fixIt = useCallback(() => {
    const m = found?.missions[0];
    if (!found || !m) return;
    setTask(m.task);
    begin(m.task, { product: { name: found.name, model: null, serial: null }, trade: "", tools: found.tools });
  }, [found, begin]);

  // Hands-free is on for every screen after the first tap (the tap is what lets the browser open the mic).
  useEffect(() => {
    handsFreeRef.current = handsFree;
    earWantedRef.current = handsFree && (phase === "identify" || phase === "loadout" || phase === "guiding" || phase === "done");
    if (earWantedRef.current) startEar();
    else stopEar();
  }, [phase, handsFree, startEar, stopEar]);
  useEffect(() => () => stopEar(), [stopEar]);
  useEffect(() => {
    if (!heard) return;
    const id = setTimeout(() => setHeard(null), 6000);
    return () => clearTimeout(id);
  }, [heard]);

  // What hands-free does with what it hears, on each screen.
  useEffect(() => {
    onHeardRef.current = (text: string) => {
      setHeard(text);
      if (phase === "guiding" && plan) {
        if (said(text, SAY.next)) return markDone();
        if (said(text, SAY.back)) return current > 0 ? goTo(current - 1) : speak("This is the first step.");
        if (said(text, SAY.repeat)) {
          const last = recentRef.current[recentRef.current.length - 1];
          return last ? speak(last) : undefined;
        }
        questionsRef.current = [...questionsRef.current, text].slice(-12);
        unlock("asked");
        tick(text);
        return;
      }
      if (phase === "identify" && found && !looking) {
        if (said(text, SAY.fix)) return fixIt();
        if (said(text, SAY.look)) return void lookAt();
        if (said(text, SAY.repeat)) return speak(found.say);
        setTask(text);
        lookAt(text);
        return;
      }
      if (phase === "loadout") {
        if (said(text, SAY.go)) return plan ? go() : speak("Almost. I'm still mapping it out.");
        return;
      }
      if (phase === "done" && report && /report|read|summary|what did i do/i.test(text)) {
        speak(`${report.didWhat} To teach it: ${report.teachBack.join(" ")}`);
      }
    };
  });

  // ── Pointing: map the coach's image coordinates onto the cover-fitted video ─
  const toScreen = (x: number, y: number) => {
    const v = videoRef.current;
    const s = stageRef.current;
    if (!v || !s || !v.videoWidth) return null;
    const ew = s.clientWidth;
    const eh = s.clientHeight;
    const scale = Math.max(ew / v.videoWidth, eh / v.videoHeight);
    const dw = v.videoWidth * scale;
    const dh = v.videoHeight * scale;
    const left = (ew - dw) / 2 + Math.min(Math.max(x, 0), 1) * dw;
    const top = (eh - dh) / 2 + Math.min(Math.max(y, 0), 1) * dh;
    return { left, top };
  };
  const pointStyle = point ? toScreen(point.x, point.y) : null;

  // "What am I looking at?": the frozen frame, whole, in the space above the info sheet.
  const snapBox = (() => {
    const st = stageRef.current;
    if (!snap || !st) return null;
    const top = 84;
    const bw = st.clientWidth - 24;
    const bh = st.clientHeight * 0.5 - top - 8;
    const scale = Math.min(bw / snap.w, bh / snap.h);
    const width = snap.w * scale;
    const height = snap.h * scale;
    return { left: (st.clientWidth - width) / 2, top: top + (bh - height) / 2, width, height };
  })();
  const onSnap = (x: number, y: number) =>
    snapBox ? { left: snapBox.left + Math.min(Math.max(x, 0), 1) * snapBox.width, top: snapBox.top + Math.min(Math.max(y, 0), 1) * snapBox.height } : toScreen(x, y);

  const step = plan?.steps[current];
  const lvl = levelOf(xp);
  const mm = String(Math.floor(elapsed / 60));
  const ss = String(elapsed % 60).padStart(2, "0");
  const mood = safety ? "🛑" : flash === "bad" ? "😬" : flash === "good" ? "🤩" : speaking ? "🗣️" : phase === "done" ? "🥳" : "🙂";
  const stars = phase === "done" && plan ? 1 + (mistakes.length === 0 ? 1 : 0) + (elapsed < plan.steps.length * 90 ? 1 : 0) : 0;
  const toast = toasts[0];

  return (
    <main ref={stageRef} className="fixed inset-0 overflow-hidden bg-[#07070A] text-white select-none">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      {phase === "identify" && snapBox && snap && (
        <>
          <div className="absolute inset-0 bg-[#07070A]" />
          <img src={snap.src} alt="" className="absolute rounded-2xl" style={{ left: snapBox.left, top: snapBox.top, width: snapBox.width, height: snapBox.height }} />
        </>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/85" />

      {/* Top: Ray (like a FaceTime bubble) and the XP bar */}
      <div className="absolute inset-x-4 top-4 flex items-center gap-3">
        <div className={`relative grid h-14 w-14 flex-none place-items-center rounded-full bg-gradient-to-br from-[#FF8A3D] to-[#E4540B] text-3xl shadow-[0_0_24px_rgba(255,107,26,.6)] ${speaking ? "ring-4 ring-[#FF6B1A]/60 animate-pulse" : ""}`}>
          <span key={mood} className="animate-[pop_.35s_ease-out]">{mood}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold">Ray <span className="font-normal text-white/60">· journeyman{kit && !live ? " · practice" : ""}</span></span>
            <span className="flex items-center gap-2">
              {phase === "guiding" && <span className="tabular-nums text-white/70">{mm}:{ss}</span>}
              {phase !== "setup" && phase !== "planning" && (
                <button
                  onClick={() => setHandsFree((h) => !h)}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${!handsFree ? "bg-white/10 text-white/50" : earOn && !speaking ? "bg-[#22C55E] text-black" : "bg-white/15"}`}
                  aria-label="Hands-free on or off"
                >
                  {!handsFree ? "🎧 Off" : earOn && !speaking ? (
                    <>
                      <span className="h-2 w-2 animate-pulse rounded-full bg-black" /> Listening
                    </>
                  ) : speaking ? (
                    "🗣️ Ray"
                  ) : (
                    "🎧 Hands-free"
                  )}
                </button>
              )}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide">{lvl.name}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-gradient-to-r from-[#FFD23F] via-[#FF6B1A] to-[#FF3D6E] transition-all duration-700" style={{ width: `${Math.round(lvl.pct * 100)}%` }} />
            </div>
            <span className="text-xs font-bold tabular-nums text-[#FFD23F]">{xp} XP</span>
          </div>
        </div>
      </div>

      {/* Combo */}
      {phase === "guiding" && combo >= 2 && (
        <div key={combo} className="absolute right-4 top-24 animate-[pop_.4s_ease-out] rounded-full bg-gradient-to-r from-[#FF3D6E] to-[#FF6B1A] px-4 py-1.5 text-lg font-black shadow-xl">
          🔥 x{combo}
        </div>
      )}

      {/* Product read from the label */}
      {plan && phase === "guiding" && (
        <div className="absolute left-4 top-24 max-w-[60%] rounded-2xl bg-black/45 px-3 py-1.5 text-xs text-white/85 backdrop-blur">
          <span className="font-semibold text-white">{plan.product.name}</span>
          {plan.product.model ? ` · ${plan.product.model}` : ""}
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

      {/* +XP */}
      {popup && (
        <div key={popup.key} onAnimationEnd={() => setPopup(null)} className="pointer-events-none absolute inset-x-0 top-[38%] animate-[floatUp_1.8s_ease-out_forwards] text-center">
          <div className="text-6xl font-black text-[#FFD23F] drop-shadow-[0_4px_0_rgba(0,0,0,.5)]">+{popup.amount} XP</div>
          <div className="mt-1 space-x-2 text-sm font-bold">
            {popup.lines.map((l) => (
              <span key={l} className="rounded-full bg-black/60 px-2 py-0.5">{l}</span>
            ))}
          </div>
        </div>
      )}

      {/* Badge unlocked */}
      {toast && (
        <div key={toast} className="pointer-events-none absolute inset-x-6 top-28 animate-[dropIn_2.6s_ease-out_forwards] rounded-3xl border border-[#FFD23F]/50 bg-gradient-to-br from-[#2A1A05] to-[#120A02] p-4 shadow-[0_0_40px_rgba(255,210,63,.35)]">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#FFD23F]/15 text-5xl">{BADGES[toast].icon}</div>
            <div>
              <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#FFD23F]">Badge unlocked</div>
              <div className="text-2xl font-black">{BADGES[toast].name}</div>
              <div className="text-sm text-white/70">{BADGES[toast].why}</div>
            </div>
          </div>
        </div>
      )}

      {/* Level up */}
      {levelUp && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40">
          <div className="animate-[pop_.5s_ease-out] text-center">
            <div className="text-sm font-extrabold uppercase tracking-[0.3em] text-[#FFD23F]">Level up</div>
            <div className="mt-2 bg-gradient-to-r from-[#FFD23F] via-[#FF6B1A] to-[#FF3D6E] bg-clip-text text-5xl font-black text-transparent">{levelUp}</div>
          </div>
        </div>
      )}

      {/* Safety */}
      {safety && phase === "guiding" && (
        <div className="absolute inset-x-4 top-36 flex items-center gap-3 rounded-3xl bg-red-600 px-4 py-3 text-xl font-extrabold shadow-2xl animate-pulse">
          <span className="text-4xl">⚠️</span>
          {safety}
        </div>
      )}

      {/* SETUP: pick a mission */}
      {phase === "setup" && (
        <div className="absolute inset-x-0 bottom-0 max-h-[calc(100%-5.5rem)] overflow-y-auto pb-8">
          <div className="px-5">
            <div className="text-xs font-extrabold uppercase tracking-[0.25em] text-[#FFB38A]">Pick a mission</div>
            <h1 className="mt-1 text-2xl font-black leading-tight">Point your camera at the job.</h1>
            <button onClick={() => lookAt()} className="mt-3 flex w-full items-center gap-3 rounded-3xl bg-white/12 bg-white/10 p-3 text-left backdrop-blur active:scale-[.98]">
              <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-white text-2xl">🔍</span>
              <span>
                <span className="block text-lg font-extrabold leading-tight">What am I looking at?</span>
                <span className="block text-sm text-white/60">Ray names it, labels the parts, and tells you where to start</span>
              </span>
            </button>
          </div>
          <div className="mt-4 flex snap-x gap-3 overflow-x-auto px-5 pb-1">
            {MISSIONS.map((m, i) => (
              <button
                key={m.title}
                onClick={() => {
                  setMission(i);
                  setTask(m.task);
                }}
                className={`w-44 flex-none snap-start rounded-3xl p-4 text-left transition ${mission === i ? "bg-gradient-to-br from-[#FF8A3D] to-[#E4540B] shadow-[0_8px_30px_rgba(255,107,26,.45)]" : "bg-white/10 backdrop-blur"}`}
              >
                <div className="text-4xl">{m.icon}</div>
                <div className="mt-2 text-base font-extrabold leading-tight">{m.title}</div>
                <div className="mt-2 flex items-center justify-between text-xs font-bold">
                  <span>{"★".repeat(m.stars)}<span className="opacity-40">{"★".repeat(3 - m.stars)}</span></span>
                  <span className="text-[#FFD23F]">+{m.xp} XP</span>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-4 px-5">
            <div className="text-xs font-extrabold uppercase tracking-[0.25em] text-white/50">Your level</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {LEVEL_PICKS.map((l) => (
                <button key={l.id} onClick={() => setLevel(l.id)} className={`rounded-2xl px-2 py-2.5 text-center transition ${level === l.id ? "bg-white text-black shadow-lg" : "bg-white/10"}`}>
                  <div className="text-2xl">{l.icon}</div>
                  <div className="text-sm font-extrabold">{l.name}</div>
                  <div className={`text-[11px] ${level === l.id ? "text-black/60" : "text-white/50"}`}>{l.hint}</div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                className="min-w-0 flex-1 rounded-2xl bg-white/12 px-4 py-3 text-base outline-none placeholder:text-white/50 backdrop-blur bg-white/10"
                placeholder="Or say what you're working on"
              />
              <button onClick={() => listen("task")} className={`rounded-2xl px-4 text-xl ${listening ? "bg-[#FF6B1A]" : "bg-white/10"}`} aria-label="Say it">
                🎙️
              </button>
            </div>
            <div className="mt-3 flex gap-2 text-sm">
              <button onClick={() => setScanLabel((s) => !s)} className={`rounded-full px-4 py-2 font-bold ${scanLabel ? "bg-white text-black" : "bg-white/10"}`}>
                🏷️ Read the label
              </button>
              <button onClick={() => setTeach((t) => !t)} className={`rounded-full px-4 py-2 font-bold ${teach ? "bg-white text-black" : "bg-white/10"}`}>
                🧠 Teach me
              </button>
            </div>
            {(camError || error) && <p className="mt-3 text-sm text-red-300">{camError ?? error}</p>}
            <button onClick={() => begin()} className="mt-5 h-16 w-full rounded-full bg-gradient-to-r from-[#FF8A3D] to-[#FF3D6E] text-xl font-black shadow-[0_10px_40px_rgba(255,107,26,.5)] active:scale-[.98]">
              📞 Call Ray
            </button>
          </div>
        </div>
      )}

      {/* What hands-free heard (on screens without the guiding caption) */}
      {heard && phase !== "guiding" && phase !== "setup" && (
        <div className="absolute inset-x-4 top-[5.25rem] z-10 flex justify-end">
          <div className="max-w-[85%] animate-[rise_.3s_ease-out] rounded-2xl rounded-br-md bg-white px-4 py-2 text-sm font-semibold text-black shadow-xl">“{heard}”</div>
        </div>
      )}

      {/* IDENTIFY: labels on the parts, where to start */}
      {phase === "identify" && looking && (
        <>
          <div className="pointer-events-none absolute inset-x-6 h-1 animate-[scan_2.4s_ease-in-out_infinite] rounded-full bg-[#FF6B1A] shadow-[0_0_30px_8px_rgba(255,107,26,.6)]" />
          <div className="absolute inset-x-0 bottom-0 p-6 pb-12 text-center">
            <div className="text-2xl font-black">Ray is taking a look…</div>
            <div className="mt-1 text-white/70">Hold steady on the whole thing</div>
          </div>
        </>
      )}
      {phase === "identify" &&
        found?.parts.map((p, i) => {
          const at = onSnap(p.x, p.y);
          if (!at) return null;
          const flip = p.x > 0.55;
          return (
            <button
              key={i}
              onClick={() => speak(`${p.label}. ${p.what}`)}
              className="absolute animate-[pop_.4s_ease-out]"
              style={{ left: at.left, top: at.top, animationDelay: `${i * 0.15}s` }}
            >
              <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full border-4 border-white bg-[#FF6B1A] shadow-[0_0_16px_#FF6B1A]" />
              <span className={`absolute -top-4 whitespace-nowrap rounded-xl bg-black/80 px-3 py-1.5 text-sm font-extrabold backdrop-blur ${flip ? "right-4" : "left-4"}`}>
                <span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full bg-[#FF6B1A] text-xs">{i + 1}</span>
                {p.label}
              </span>
            </button>
          );
        })}
      {phase === "identify" && !looking && (
        <div className="absolute inset-x-0 bottom-0 max-h-[52%] animate-[rise_.45s_ease-out] overflow-y-auto rounded-t-[2rem] bg-[#121216]/95 p-5 pb-7 backdrop-blur-md">
          {found ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-3xl font-black leading-none">{found.name}</h1>
                  <p className="mt-1.5 text-white/70">{found.what}</p>
                </div>
                <button onClick={() => speak(found.say)} className="grid h-12 w-12 flex-none place-items-center rounded-full bg-white/10 text-xl" aria-label="Say it again">
                  🔊
                </button>
              </div>
              {found.callPro && (
                <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[#DC2626]/20 px-3 py-2 text-sm ring-1 ring-[#DC2626]/60">
                  <span className="text-xl">🧯</span>
                  <span>{found.callPro}</span>
                </div>
              )}
              <div className="mt-4 text-xs font-extrabold uppercase tracking-[0.2em] text-[#FFB38A]">You&apos;ll need</div>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {found.tools.map((t, i) => (
                  <div key={i} className="flex-none rounded-2xl bg-white/10 px-3 py-2 text-center">
                    <div className="text-3xl">{t.icon}</div>
                    <div className="mt-0.5 text-xs font-bold">{t.name}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs font-extrabold uppercase tracking-[0.2em] text-[#FFB38A]">Start here</div>
              <ol className="mt-2 space-y-2">
                {found.start.slice(0, 3).map((x, i) => (
                  <li key={i} className="flex items-center gap-3" onClick={() => speak(`${x.title}. ${x.how}`)}>
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-white text-sm font-black text-black">{i + 1}</span>
                    <span className="leading-tight">
                      <span className="block font-extrabold">{x.title}</span>
                      <span className="text-sm text-white/60">{x.how}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {found.missions[0] && (
                <button
                  onClick={fixIt}
                  className="mt-5 flex h-16 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#FF8A3D] to-[#FF3D6E] text-xl font-black shadow-[0_10px_40px_rgba(255,107,26,.5)] active:scale-[.98]"
                >
                  📞 Fix it with Ray
                </button>
              )}
              {handsFree && found.missions[0] && <p className="mt-2 text-center text-xs text-white/45">Or just say “fix it”, or tell Ray what&apos;s wrong</p>}
            </>
          ) : (
            <p className="text-red-300">{error ?? "Ray couldn't make that out."}</p>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-sm font-bold">
            <button onClick={() => listen("identify")} className={`rounded-2xl py-3 ${listening ? "bg-[#FF6B1A] animate-pulse" : "bg-white/10"}`}>
              🎙️ What&apos;s wrong?
            </button>
            <button onClick={() => lookAt()} className="rounded-2xl bg-white/10 py-3">
              🔄 Look again
            </button>
            <button
              onClick={() => {
                window.speechSynthesis?.cancel();
                setPhase("setup");
                setFound(null);
                setSnap(null);
              }}
              className="rounded-2xl bg-white/10 py-3"
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}

      {/* PLANNING */}
      {phase === "planning" && (
        <div className="absolute inset-x-0 bottom-0 p-6 pb-12 text-center">
          <div className="mx-auto mb-5 grid h-20 w-20 animate-bounce place-items-center rounded-full bg-gradient-to-br from-[#FF8A3D] to-[#E4540B] text-4xl">📞</div>
          <div className="text-2xl font-black">Ray is picking up…</div>
          <div className="mt-1 text-white/70">{scanLabel ? "Reading the label, sizing up the job" : "Sizing up the job"}</div>
          <div className="mx-auto mt-5 max-w-xs rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/80">💡 Pro tip: {["Unplug first. Always.", "Read the data plate before you diagnose anything.", "Most no-cool calls are airflow, not refrigerant.", "Gloves on before your hands go behind a unit."][Math.floor(Date.now() / 4000) % 4]}</div>
        </div>
      )}

      {/* LOADOUT: the tools for this job */}
      {phase === "loadout" && kit && (
        <div className="absolute inset-0 overflow-y-auto bg-black/75 p-6 pt-24 backdrop-blur-md">
          <div className="text-xs font-extrabold uppercase tracking-[0.3em] text-[#FFB38A]">Loadout</div>
          <h1 className="mt-1 text-3xl font-black leading-tight">Grab your gear</h1>
          <div className="mt-1 text-white/60">
            {kit.product.name}
            {kit.product.model ? ` · ${kit.product.model}` : ""} · {LEVEL_PICKS.find((l) => l.id === level)?.icon} {LEVEL_PICKS.find((l) => l.id === level)?.name}
            {plan ? ` · ${plan.steps.length} steps` : ""}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {kit.tools.map((t, i) => {
              const on = gear.has(i);
              return (
                <button
                  key={i}
                  onClick={() => {
                    setGear((g) => {
                      const n = new Set(g);
                      if (n.has(i)) n.delete(i);
                      else {
                        n.add(i);
                        cue("coin");
                      }
                      return n;
                    });
                  }}
                  className={`relative rounded-3xl p-4 text-left transition active:scale-95 ${on ? "bg-[#22C55E]/25 ring-2 ring-[#22C55E]" : "bg-white/10"}`}
                >
                  <div className="text-5xl">{t.icon}</div>
                  <div className="mt-2 text-lg font-extrabold leading-tight">{t.name}</div>
                  <div className={`absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-lg font-black ${on ? "bg-[#22C55E]" : "bg-white/15"}`}>{on ? "✓" : ""}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-center text-sm text-white/55">
            {gear.size}/{kit.tools.length} ready · +{10 * kit.tools.length} XP for gearing up
            {handsFree && <div className="mt-1 text-white/45">Say “let&apos;s go” when you&apos;re ready</div>}
          </div>
          {plan ? (
            <button onClick={go} className="mt-5 h-16 w-full animate-[pop_.4s_ease-out] rounded-full bg-gradient-to-r from-[#FF8A3D] to-[#FF3D6E] text-xl font-black shadow-[0_10px_40px_rgba(255,107,26,.5)] active:scale-[.98]">
              {gear.size >= kit.tools.length ? "Let's go 🚀" : "Start anyway"}
            </button>
          ) : planFailed ? (
            <button onClick={retrySteps} className="mt-5 h-16 w-full rounded-full bg-white/15 text-lg font-black active:scale-[.98]">
              Ray lost the plan. Tap to retry 🔁
            </button>
          ) : (
            <div className="mt-5 flex h-16 w-full items-center justify-center gap-3 rounded-full bg-white/10 text-lg font-bold text-white/80">
              <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-[#FF8A3D]" />
              Ray is mapping your mission…
            </div>
          )}
        </div>
      )}

      {/* GUIDING */}
      {phase === "guiding" && plan && step && (
        <div className="absolute inset-x-0 bottom-0 p-5 pb-7">
          {heard && !speaking && <div className="mb-3 ml-auto w-fit max-w-[85%] animate-[rise_.3s_ease-out] rounded-2xl rounded-br-md bg-white px-4 py-2 text-base font-semibold text-black">“{heard}”</div>}
          {caption && speaking && <div className="mb-3 line-clamp-2 rounded-2xl bg-black/60 px-4 py-2 text-base leading-snug text-white/95 backdrop-blur">{caption}</div>}
          <div className="flex items-center gap-4">
            <div
              className="grid h-24 w-24 flex-none place-items-center rounded-full p-1.5"
              style={{ background: `conic-gradient(${ORANGE} ${(current / plan.steps.length) * 360}deg, rgba(255,255,255,.15) 0deg)` }}
            >
              <div key={current} className="grid h-full w-full animate-[pop_.4s_ease-out] place-items-center rounded-full bg-[#121216] text-5xl">{step.icon}</div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-[#FFB38A]">
                Step {current + 1} / {plan.steps.length} <span className="text-[#FFD23F]">· +75 XP</span>
              </div>
              <div className="text-3xl font-black leading-tight">{step.title}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-5 gap-2.5">
            <button
              onClick={() => goTo(current - 1)}
              disabled={current === 0}
              className="grid h-20 place-items-center rounded-3xl bg-white/10 text-3xl backdrop-blur active:scale-95 disabled:opacity-30"
              aria-label="Back one step"
            >
              ⏮️
            </button>
            <button
              onClick={() => {
                const last = recentRef.current[recentRef.current.length - 1];
                if (last) speak(last);
              }}
              className="grid h-20 place-items-center rounded-3xl bg-white/12 text-3xl backdrop-blur bg-white/10 active:scale-95"
              aria-label="Repeat"
            >
              🔁
            </button>
            <button onClick={() => listen("ask")} className={`col-span-2 grid h-20 place-items-center rounded-3xl text-3xl active:scale-95 ${listening ? "bg-[#FF6B1A] animate-pulse" : "bg-white text-black"}`} aria-label="Ask Ray">
              {listening ? "👂" : "🎙️"}
            </button>
            <button onClick={markDone} className="grid h-20 place-items-center rounded-3xl bg-[#22C55E] text-3xl shadow-[0_8px_24px_rgba(34,197,94,.45)] active:scale-95" aria-label="Done with this step">
              ✓
            </button>
          </div>
          <button onClick={() => setShowSteps(true)} className="mt-3 w-full text-center text-sm text-white/55">
            {handsFree ? "🎙️ Just talk: “next”, “back”, “repeat”, or ask · Map" : "Mission map · tap any step to jump"}
          </button>
        </div>
      )}

      {/* Steps drawer */}
      {showSteps && plan && (
        <div className="absolute inset-0 bg-black/80 p-5 pt-20 backdrop-blur" onClick={() => setShowSteps(false)}>
          <div className="text-2xl font-black">Mission map</div>
          <div className="mt-1 text-sm text-white/60">Tools: {plan.tools.map((t) => `${t.icon} ${t.name}`).join("  ")}</div>
          <ol className="mt-5 space-y-3">
            {plan.steps.map((s, i) => (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-2xl p-1 ${phase === "guiding" && i !== current ? "active:bg-white/10" : ""}`}
                onClick={(e) => {
                  if (phase !== "guiding") return;
                  e.stopPropagation();
                  goTo(i);
                }}
              >
                <span className={`grid h-11 w-11 flex-none place-items-center rounded-full text-xl ${i < current ? "bg-[#22C55E]" : i === current ? "bg-[#FF6B1A]" : "bg-white/10"}`}>{i < current ? "✓" : s.icon}</span>
                <div>
                  <div className="font-bold">{s.title}</div>
                  <div className="text-xs text-white/55">{s.skill}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* DONE: the job card */}
      {phase === "done" && plan && (
        <div className="absolute inset-0 overflow-y-auto bg-[radial-gradient(ellipse_at_top,#3A1A06,#07070A_60%)] p-6 pt-24">
          <div className="text-center">
            <div className="text-xs font-extrabold uppercase tracking-[0.3em] text-[#22C55E]">Mission complete</div>
            <div className="mt-3 text-6xl tracking-widest">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`inline-block animate-[pop_.5s_ease-out] ${i < stars ? "text-[#FFD23F] drop-shadow-[0_0_12px_rgba(255,210,63,.7)]" : "text-white/15"}`} style={{ animationDelay: `${i * 0.25}s` }}>
                  ★
                </span>
              ))}
            </div>
            <h1 className="mt-3 text-3xl font-black leading-tight">{plan.product.name}</h1>
            <div className="mt-1 text-white/60">
              {plan.steps.length} steps · {mm}:{ss} · {mistakes.length} {mistakes.length === 1 ? "mistake" : "mistakes"}
            </div>
            <div className="mt-6 text-7xl font-black text-[#FFD23F]">+{jobXp}</div>
            <div className="text-sm font-bold uppercase tracking-widest text-white/60">XP earned · TradesQuest</div>
            <div className="mx-auto mt-4 max-w-sm">
              <div className="flex justify-between text-xs font-bold">
                <span>{lvl.name}</span>
                <span className="text-white/50">{lvl.next - xp} XP to next</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gradient-to-r from-[#FFD23F] via-[#FF6B1A] to-[#FF3D6E] transition-all duration-1000" style={{ width: `${Math.round(lvl.pct * 100)}%` }} />
              </div>
            </div>
          </div>
          <h2 className="mt-8 text-lg font-black">Badges</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(Object.keys(BADGES) as BadgeId[]).map((id) => (
              <div key={id} className={`rounded-2xl p-3 text-center ${badges.includes(id) ? "bg-[#FFD23F]/12 bg-white/10" : "bg-white/5 opacity-40 grayscale"}`}>
                <div className="text-3xl">{BADGES[id].icon}</div>
                <div className="mt-1 text-xs font-bold leading-tight">{BADGES[id].name}</div>
              </div>
            ))}
          </div>
          <h2 className="mt-7 text-lg font-black">Skills you practiced</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {plan.steps.map((s, i) => (
              <span key={i} className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold">
                {s.icon} {s.skill}
              </span>
            ))}
          </div>
          {mistakes.length > 0 && (
            <>
              <h2 className="mt-6 text-lg font-black">Caught and fixed</h2>
              <ul className="mt-2 space-y-1 text-sm text-white/75">
                {mistakes.map((m, i) => (
                  <li key={i}>✋ {m}</li>
                ))}
              </ul>
            </>
          )}
          <section className="mt-8 rounded-3xl bg-white/[.06] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">🛠️ Your job report</h2>
              {report && <span className="text-xs font-bold uppercase tracking-widest text-white/40">Saved to logbook</span>}
            </div>
            {reportState === "loading" && !report && (
              <div className="mt-4 flex items-center gap-3 text-white/70">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-[#FF8A3D]" />
                Ray is writing up your job…
              </div>
            )}
            {reportState === "error" && !report && (
              <button onClick={writeReport} className="mt-4 text-[#FFB38A] underline">
                Couldn&apos;t write it. Tap to try again.
              </button>
            )}
            {report && (
              <div className="animate-[rise_.45s_ease-out]">
                <p className="mt-3 text-xl font-extrabold leading-snug">{report.headline}</p>
                <p className="mt-3 leading-relaxed text-white/80">{report.didWhat}</p>
                <h3 className="mt-5 text-xs font-extrabold uppercase tracking-[0.2em] text-[#FFB38A]">What I learned</h3>
                <ul className="mt-2 space-y-1.5">
                  {report.learned.map((x, i) => (
                    <li key={i} className="flex gap-2">
                      <span>💡</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-5 text-xs font-extrabold uppercase tracking-[0.2em] text-[#FFB38A]">Teach it to someone</h3>
                <ol className="mt-2 space-y-1.5">
                  {report.teachBack.map((x, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-[#FF6B1A] text-xs font-black">{i + 1}</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 text-sm text-white/65">
                  <span className="font-bold text-white">Next time:</span> {report.nextTime}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button onClick={shareReport} className="h-14 rounded-full bg-white text-base font-black text-black active:scale-[.98]">
                    {shared ?? "📤 Share report"}
                  </button>
                  <button
                    onClick={() => speak(`${report.didWhat} To teach it: ${report.teachBack.join(" ")}`)}
                    className="h-14 rounded-full bg-white/10 text-base font-bold active:scale-[.98]"
                  >
                    🔊 Read it to me
                  </button>
                </div>
              </div>
            )}
          </section>
          <div className="mt-8 grid gap-3 pb-12">
            <button
              onClick={() => {
                jobRef.current++;
                setPhase("setup");
                setPlan(null);
                setKit(null);
                setReport(null);
                setCaption(null);
              }}
              className="h-16 rounded-full bg-gradient-to-r from-[#FF8A3D] to-[#FF3D6E] text-xl font-black shadow-[0_10px_40px_rgba(255,107,26,.5)]"
            >
              Next mission →
            </button>
            <button className="h-14 rounded-full bg-white/10 text-base font-bold">📞 Call a real pro</button>
          </div>
        </div>
      )}
    </main>
  );
}
