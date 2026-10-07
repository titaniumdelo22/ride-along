"use client";

import confetti from "canvas-confetti";
import { speak as sayAloud, isSpeaking, stopSpeaking } from "@/lib/voice";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Kit, Plan, Report, Watch } from "@/lib/guide";
import type { Identify } from "@/lib/identify";
import RayFace from "./RayFace";

type Phase = "setup" | "identify" | "planning" | "loadout" | "guiding" | "done";
type Level = "newbie" | "intermediate" | "advanced";
const LEVEL_PICKS: { id: Level; icon: string; name: string; hint: string }[] = [
  { id: "newbie", icon: "🐣", name: "Newbie", hint: "Never done it" },
  { id: "intermediate", icon: "🔧", name: "Intermediate", hint: "A few times" },
  { id: "advanced", icon: "🏆", name: "Advanced", hint: "I'm a pro" },
];
type Point = NonNullable<Watch["point"]>;
// A step Ray added mid-job because something unexpected showed up.
type JobStep = Plan["steps"][number] & { surprise?: boolean };

// Minimal typing for the browser's speech recognition (webkit prefix on Safari/Chrome).
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex?: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null;
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

// Live, like FaceTime: a fresh look every 1.5 s, up to 2 in flight at once (each takes a few seconds round trip).
const WATCH_EVERY_MS = 1500;
// Points are off for now (less on screen): a finished step just gets "Nice!" and confetti.
const SHOW_XP = false;
const NICE = ["Nice!", "Clean!", "That's it!", "Nailed it!"];
// What Ray says the instant he hears a question, so there's no dead air while he looks.
const REBUILD = "Help me put this back together the way it was in my before photos.";
const FILLERS = ["Okay, let me look.", "Got it. One sec.", "Mm, let me see.", "Okay, show me.", "Alright, let me look at that."];
const MAX_LOOKS = 2;
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
  { icon: "📺", title: "Mount a TV", task: "I want to mount my TV on the wall. Teach me to do it right.", xp: 300, stars: 2 },
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
  curveball: { icon: "🚧", name: "Curveball", why: "Handled a surprise" },
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
  const inFlight = useRef(0);
  const seqRef = useRef(0); // each look is numbered so an older answer never overwrites a newer one
  const appliedRef = useRef(0);
  const currentRef = useRef(0);
  const movingRef = useRef(false); // the camera is moving: wait until they hold still, then look
  const lastSayAt = useRef(0);
  const recentRef = useRef<string[]>([]);
  const talkRef = useRef<{ who: "ray" | "you"; text: string }[]>([]); // the conversation, both sides
  const questionsRef = useRef<string[]>([]);
  const redoneRef = useRef<string[]>([]);
  const surprisesRef = useRef<string[]>([]);
  const missingRef = useRef<string[]>([]); // tools they left unchecked on the gear screen
  const [unplugged, setUnplugged] = useState(false); // confirmed up front, so the unplug step is skipped
  const shotsRef = useRef<string[]>([]); // photos Ray takes as each step starts, for putting it back together later
  const fileRef = useRef<HTMLInputElement>(null);
  const clearedRef = useRef<Set<number>>(new Set());
  const verifiedRef = useRef<Set<string>>(new Set()); // steps Ray saw done on camera (by title), the proof an employer can trust
  const jobRef = useRef(0);
  const handsFreeRef = useRef(true);
  const armedRef = useRef(false); // the first tap happened (browsers only open the mic after one)
  const screenEarRef = useRef(false); // this screen listens
  const blockedRef = useRef(false);
  const keepOpenRef = useRef(false); // phones that won't reopen the mic: keep it open the whole call, ignore Ray's own voice
  const quickEnds = useRef(0);
  const earWantedRef = useRef(false);
  const earRef = useRef<Recognition | null>(null);
  const talkingRef = useRef(false);
  const uttRef = useRef<SpeechSynthesisUtterance | null>(null);
  const onHeardRef = useRef<(text: string) => void>(() => {});
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
  // The start, one question per page: your level (asked once), point at it, or pick the job.
  const [page, setPage] = useState<"level" | "point" | "job">("level");
  const [picked, setPicked] = useState<{ task: string; name: string } | null>(null); // a job tapped on the home page
  const autoRef = useRef(false); // a handed-over job starts by itself, once
  const [task, setTask] = useState(MISSIONS[0].task);
  // Always on: read the label, and teach (ask what comes next) instead of just telling.
  const scanLabel = true;
  const teach = true;
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
  const [needTap, setNeedTap] = useState(false); // the phone refused to reopen the mic by itself: one tap anywhere fixes it
  const [heard, setHeard] = useState<string | null>(null);
  const [curveball, setCurveball] = useState<string | null>(null);
  const [sees, setSees] = useState<string | null>(null);
  const [cam, setCam] = useState({ dark: false, moving: false });
  // Before photos: how it looked as it came apart (from a job with Ray, or added from the camera roll).
  const [befores, setBefores] = useState<string[]>([]);
  const [jobBefores, setJobBefores] = useState<string[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const [found, setFound] = useState<Identify | null>(null);
  const [showAll, setShowAll] = useState(false); // one ring on the most important thing; the rest only when asked
  const [foundMode, setFoundMode] = useState<"what" | "parts">("what");
  const [looking, setLooking] = useState(false);
  const [lookStage, setLookStage] = useState<"hold" | "thinking">("hold"); // hold still for the shot, then Ray thinks
  const [lookT, setLookT] = useState(0); // seconds since the shot, for the progress line
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
  const [nice, setNice] = useState<{ word: string; key: number } | null>(null);
  const [toasts, setToasts] = useState<BadgeId[]>([]);
  const [levelUp, setLevelUp] = useState<string | null>(null);
  const [badges, setBadges] = useState<BadgeId[]>([]);
  // The certificate track: verified jobs and hours add up toward a credential, so learning at home leads to a job.
  const [cert, setCert] = useState({ jobs: 0, verified: 0, minutes: 0 });

  useEffect(() => {
    xpRef.current = readXp();
    try {
      const b = JSON.parse(localStorage.getItem("ra.befores") ?? "[]");
      if (Array.isArray(b)) setBefores(b.filter((x) => typeof x === "string").slice(0, 8));
    } catch {}
    try {
      const saved = localStorage.getItem("ra.level");
      if (saved === "newbie" || saved === "intermediate" || saved === "advanced") {
        setLevel(saved);
        setPage("point");
      }
    } catch {}
    try {
      const q = new URLSearchParams(window.location.search);
      const t = q.get("task");
      if (t) {
        setPicked({ task: t.slice(0, 300), name: (q.get("name") ?? "This job").slice(0, 40) });
        setTask(t.slice(0, 300));
      }
    } catch {}
    setXp(xpRef.current);
    try {
      const c = JSON.parse(localStorage.getItem("ra.cert") ?? "null");
      if (c && typeof c.jobs === "number") setCert({ jobs: c.jobs, verified: c.verified || 0, minutes: c.minutes || 0 });
    } catch {}
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

  const capture = useCallback((maxW = 768, quality = 0.6): string | null => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || !v.videoWidth) return null;
    const w = Math.min(maxW, v.videoWidth);
    const h = Math.round((v.videoHeight / v.videoWidth) * w);
    c.width = w;
    c.height = h;
    c.getContext("2d")?.drawImage(v, 0, 0, w, h);
    return c.toDataURL("image/jpeg", quality).split(",")[1] ?? null;
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
    if (!handsFreeRef.current || !earWantedRef.current || earRef.current || blockedRef.current) return;
    if (talkingRef.current && !keepOpenRef.current) return;
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = keepOpenRef.current;
    const opened = Date.now();
    const echo = () => talkingRef.current || Date.now() - lastSayAt.current < 700; // Ray hearing himself
    r.onresult = (e) => {
      if (!echo()) voiceAt.current = Date.now();
      const list = Array.from(e.results);
      for (let i = e.resultIndex ?? 0; i < list.length; i++) {
        if (!list[i].isFinal) continue; // still talking
        const alt = list[i][0] as { transcript: string; confidence?: number };
        const text = alt.transcript.trim();
        if (alt.confidence && alt.confidence < 0.4) continue; // mumble from across the room
        if (text && !echo()) onHeardRef.current(text);
      }
    };
    const blocked = () => {
      // This phone won't reopen the mic on its own: from the next tap, keep it open for the whole call.
      blockedRef.current = true;
      keepOpenRef.current = true;
      setNeedTap(true);
    };
    r.onerror = (e) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") blocked();
    };
    r.onend = () => {
      if (earRef.current !== r) return;
      earRef.current = null;
      setEarOn(false);
      if (blockedRef.current) return;
      // Closing instantly again and again means it's being refused quietly.
      quickEnds.current = Date.now() - opened < 1000 ? quickEnds.current + 1 : 0;
      if (quickEnds.current >= 3) {
        quickEnds.current = 0;
        return blocked();
      }
      setTimeout(start, quickEnds.current ? 1500 : 250);
    };
    earRef.current = r;
    setEarOn(true);
    try {
      r.start();
    } catch {
      earRef.current = null;
      setEarOn(false);
      blocked();
    }
  }, []);

  // ── Voice out ─────────────────────────────────────────────────────────────
  const speak = useCallback((text: string, opts?: { filler?: boolean }) => {
    setCaption(text);
    setHeard(null);
    if (!opts?.filler) {
      recentRef.current = [...recentRef.current, text].slice(-4);
      talkRef.current = [...talkRef.current, { who: "ray" as const, text }].slice(-12);
    }
    if (typeof window === "undefined") return;
    talkingRef.current = true;
    if (!keepOpenRef.current) stopEar();
    // Ray speaks with the cloned Cartesia voice (falls back to the phone voice inside lib/voice).
    const token = {};
    uttRef.current = token as unknown as SpeechSynthesisUtterance;
    const finish = () => {
      if (uttRef.current !== (token as unknown as SpeechSynthesisUtterance)) return;
      uttRef.current = null;
      talkingRef.current = false;
      lastSayAt.current = Date.now();
      setSpeaking(false);
      setTimeout(startEar, 350);
    };
    // Some phones never fire an end event: don't leave the mic closed forever.
    setTimeout(() => {
      if (uttRef.current === (token as unknown as SpeechSynthesisUtterance) && !isSpeaking()) finish();
    }, 4000 + text.length * 90);
    void sayAloud(text, { onStart: () => setSpeaking(true), onEnd: finish });
  }, [stopEar, startEar]);

  // ── The game's moments ────────────────────────────────────────────────────
  // quiet: add the XP without the big pop-up (a badge already gets its own toast).
  const award = useCallback((amount: number, lines: string[], quiet = false) => {
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
    if (!quiet && SHOW_XP) setPopup({ amount, lines, key: Date.now() });
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
      award(25, [`${BADGES[id].icon} ${BADGES[id].name}`], true);
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
      const shot = capture();
      if (shot) shotsRef.current = [...shotsRef.current, shot].slice(-8);
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
      if (!SHOW_XP) {
        setNice({ word: NICE[Math.floor(Math.random() * NICE.length)], key: Date.now() });
        burst();
      }
      if (next >= 3) setTimeout(() => unlock("onfire"), 1400);
      if (index === 0) setTimeout(() => unlock("safety"), 1600);
      stepMistake.current = false;
      setFlash("good");
      cue("good");
      if (index + 1 >= total) setTimeout(() => setPhase("done"), 1800);
      else setCurrent(index + 1);
    },
    [award, unlock, capture]
  );

  // The before photo for a step, when putting it back together.
  const refPhoto = useCallback(
    (i: number): string | null => {
      const n = plan?.steps[i]?.photo;
      return n != null && jobBefores[Math.round(n)] ? jobBefores[Math.round(n)] : null;
    },
    [plan, jobBefores]
  );

  // Before photos from the camera roll (taken while it came apart), in the order they were taken.
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files)
      .sort((a, b) => a.lastModified - b.lastModified)
      .slice(0, 8);
    const out: string[] = [];
    for (const f of list) {
      try {
        const bmp = await createImageBitmap(f);
        const w = Math.min(768, bmp.width);
        const h = Math.round((bmp.height / bmp.width) * w);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
        const b64 = c.toDataURL("image/jpeg", 0.6).split(",")[1];
        if (b64) out.push(b64);
      } catch {}
    }
    if (!out.length) return;
    setBefores(out);
    cue("coin");
    try {
      localStorage.setItem("ra.befores", JSON.stringify(out));
    } catch {}
  };

  // ── Plan ──────────────────────────────────────────────────────────────────
  // Start where they are: if they're already partway, the steps before it count as done (no XP for them).
  const loadPlan = useCallback((p: Plan) => {
    const at = Math.max(0, Math.min(Math.round(Number(p.startAt) || 0), p.steps.length - 1));
    setPlan(p);
    setCurrent(at);
    clearedRef.current = new Set(Array.from({ length: at }, (_, i) => i));
  }, []);

  const begin = useCallback(async (override?: string, known?: Kit, photos?: string[]) => {
    setError(null);
    setPhase("planning");
    // Unlock speech and sound on iOS inside the tap.
    try {
      window.speechSynthesis?.speak(new SpeechSynthesisUtterance(" "));
      tone(1, 0, 0.01, "sine", 0.0001);
    } catch {}
    const job = ++jobRef.current;
    const body = JSON.stringify({ task: override ?? task, level, frame: scanLabel ? capture() : null, befores: photos ?? [] });
    setJobBefores(photos ?? []);
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
      verifiedRef.current = new Set();
      stepMistake.current = false;
      recentRef.current = [];
      talkRef.current = [];
      questionsRef.current = [];
      redoneRef.current = [];
      surprisesRef.current = [];
      setCurveball(null);
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
          loadPlan({ ...d.plan, product: k.product.model || !d.plan.product.model ? k.product : d.plan.product, tools: k.tools });
        })
        .catch(() => job === jobRef.current && setPlanFailed(true));
    } catch {
      setError("Your pro couldn't load that job. Try again.");
      setPhase("setup");
    }
  }, [task, level, scanLabel, capture, speak, unlock, live, loadPlan]);

  // ── "What am I looking at?" ───────────────────────────────────────────────
  const lookAt = useCallback(
    async (problem?: string, mode: "what" | "parts" = "what") => {
      setError(null);
      setPhase("identify");
      setFound(null);
      setShowAll(false);
      setFoundMode(mode);
      setLooking(true);
      try {
        window.speechSynthesis?.speak(new SpeechSynthesisUtterance(" "));
        tone(1, 0, 0.01, "sine", 0.0001);
      } catch {}
      // Hold still for one beat (a ring fills), then the shutter: after that they can relax.
      setLookStage("hold");
      await new Promise((r) => setTimeout(r, 1100));
      const frame = capture();
      cue("coin");
      setFlash("good");
      setLookStage("thinking");
      setLookT(0);
      setSnap(frame && canvasRef.current ? { src: `data:image/jpeg;base64,${frame}`, w: canvasRef.current.width, h: canvasRef.current.height } : null);
      // The mission presets aren't a description of what's in front of them; only send what they typed or said.
      const said = problem ?? (MISSIONS.some((m) => m.task === task) ? "" : task);
      try {
        const res = await fetch("/api/identify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ frame, problem: said, level, mode, befores: mode === "parts" ? befores : [] }),
        });
        const d = (await res.json()) as { result?: Identify; live?: boolean; error?: string };
        if (!d.result) throw new Error(d.error ?? "no result");
        setFound(d.result);
        setLive(d.live !== false);
        speak(d.result.say);
        // Claude picks what matters; Gemini finds exactly where it is. The ring slides onto the right spot.
        const r = d.result;
        const names = [r.focus?.label, ...r.parts.map((p) => p.label)].filter((n): n is string => !!n);
        if (frame && names.length) {
          fetch("/api/locate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frame, names }) })
            .then((x) => x.json())
            .then((l: { spots?: { label: string; x: number; y: number }[] }) => {
              const spot = (name: string) => l.spots?.find((s) => s.label.trim().toLowerCase() === name.trim().toLowerCase());
              setFound((f) => {
                if (f !== r) return f;
                const fs = f.focus && spot(f.focus.label);
                return {
                  ...f,
                  focus: f.focus && fs ? { ...f.focus, x: fs.x, y: fs.y } : f.focus,
                  parts: f.parts.map((p) => {
                    const s = spot(p.label);
                    return s ? { ...p, x: s.x, y: s.y } : p;
                  }),
                };
              });
            })
            .catch(() => {});
        }
        // Write the steps ahead while they read: the rebuild (with their before photos) after a parts check.
        const rebuild = mode === "parts" && befores.length > 0;
        const m = d.result.missions[0];
        const next = rebuild ? REBUILD : m?.task;
        if (next) {
          const steps = fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: next, level, frame, befores: rebuild ? befores : [] }) }).then((r) => r.json());
          steps.catch(() => {});
          aheadRef.current = { task: next, level, steps };
        }
        award(15, [mode === "parts" ? "🔩 Parts sorted" : "🔍 New machine spotted"]);
      } catch {
        setError("Ray couldn't make that out. Get a little closer and try again.");
      } finally {
        setLooking(false);
      }
    },
    [capture, task, level, speak, award, befores]
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
        loadPlan({ ...d.plan, product: kit.product, tools: kit.tools });
      })
      .catch(() => job === jobRef.current && setPlanFailed(true));
  }, [kit, task, level, loadPlan]);

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
    const first = capture();
    shotsRef.current = first ? [first] : [];
    setSees(null);
    // Already confirmed it's unplugged: skip the unplug step(s) and tell Ray.
    let steps = plan.steps;
    if (unplugged) {
      const keep = plan.steps.filter((s) => !/unplug/i.test(`${s.title} ${s.instruction}`));
      if (keep.length && keep.length < plan.steps.length) {
        steps = keep;
        setPlan({ ...plan, steps: keep });
        setCurrent(Math.min(current, keep.length - 1));
      }
      talkRef.current = [...talkRef.current, { who: "you" as const, text: "It's already unplugged." }];
    }
    // Tools they left unchecked (only if they checked any; no checks means they didn't say).
    const missing = gear.size ? plan.tools.filter((_, i) => !gear.has(i)) : [];
    missingRef.current = missing.map((t) => t.name);
    const mustMissing = missing.filter((t) => t.need).map((t) => t.name);
    setPhase("guiding");
    award(10 * plan.tools.length, ["🎒 Geared up"]);
    const safety = plan.hazards?.length ? `Safety first: ${plan.hazards.map((h) => h.text).join(" ")} ` : "";
    const tools = mustMissing.length ? `Heads up, you'll need ${mustMissing.join(" and ")} for part of this. I'll tell you when. ` : "";
    const at = Math.min(current, steps.length - 1);
    speak(`${safety}${unplugged ? "Good, it's unplugged. " : ""}${tools}${at > 0 ? `Picking up at step ${at + 1}` : "Step one"}: ${steps[at].instruction}`);
  }, [plan, current, award, speak, capture, gear, unplugged]);

  // ── Watch loop ────────────────────────────────────────────────────────────
  const tick = useCallback(
    async (userSaid: string | null = null) => {
      if (!plan) return;
      if (!userSaid) {
        if (inFlight.current >= MAX_LOOKS) return;
        if (Date.now() - voiceAt.current < 2500) return; // they're talking: wait for what they say

      }
      const seq = ++seqRef.current;
      const at = current;
      const sentFrame = capture(512, 0.5);
      inFlight.current++;
      try {
        const res = await fetch("/api/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ frame: sentFrame, task, level, plan, current: at, teach, recent: recentRef.current, talk: talkRef.current, userSaid, surprises: surprisesRef.current, ref: refPhoto(at), done: plan.steps.slice(0, at).map((s) => s.title), missingTools: missingRef.current }),
        });
        const w = (await res.json()) as Watch & { error?: string };
        if (w.error) return;
        // A newer look already landed: this one is old news (a question always counts).
        if (!userSaid && seq < appliedRef.current) return;
        appliedRef.current = Math.max(appliedRef.current, seq);
        const sameStep = currentRef.current === at;
        setSees(w.see);
        if (w.point) {
          setPoint(w.point);
          // Claude says what; Gemini finds exactly where, so the ring lands on the part.
          const pt = w.point;
          if (sentFrame) {
            fetch("/api/locate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frame: sentFrame, names: [pt.label] }) })
              .then((r) => r.json())
              .then((l: { spots?: { label: string; x: number; y: number }[] }) => {
                const s0 = l.spots?.[0];
                if (s0) setPoint((cur) => (cur && cur.label === pt.label ? { ...cur, x: s0.x, y: s0.y } : cur));
              })
              .catch(() => {});
          }
        }
        setAim(w.aim);
        if (w.safety) {
          setFlash("danger");
          cue("danger");
        }
        setSafety(w.safety);
        if (w.mistake && sameStep) {
          setMistakes((m) => [...m, w.mistake as string]);
          stepMistake.current = true;
          comboRef.current = 0;
          setCombo(0);
          setFlash("bad");
          cue("bad");
        }
        // A curveball: Ray adds the steps to handle it, right here, before the rest of the job.
        let detour = false;
        if (w.surprise && sameStep && !surprisesRef.current.includes(w.surprise.what)) {
          surprisesRef.current = [...surprisesRef.current, w.surprise.what];
          const extra: JobStep[] = w.surprise.steps.map((x) => ({ ...x, surprise: true }));
          if (extra.length) {
            detour = true;
            setPlan((p) => (p ? { ...p, steps: [...p.steps.slice(0, at), ...extra, ...p.steps.slice(at)] } : p));
          }
          setCurveball(w.surprise.what);
          cue("badge");
          award(30, ["🚧 Curveball spotted"]);
        }
        // Talk like a person on a call: answer questions right away, otherwise short reactions with a breath between them.
        // Steps the camera shows aren't needed come off the plan.
        if (w.drop?.length && sameStep && !detour) {
          const gone = new Set(w.drop);
          setPlan((p) => (p ? { ...p, steps: p.steps.filter((s, i) => i <= at || !gone.has(s.title)) } : p));
        }
        const theyreTalking = !userSaid && Date.now() - voiceAt.current < 2500;
        const rayTalking = isSpeaking();
        if (w.say && !theyreTalking && (userSaid || (!rayTalking && Date.now() - lastSayAt.current > 2000))) speak(w.say);
        else if (w.safety && !rayTalking) speak(w.safety);
        if (w.stepDone && sameStep && !detour) {
          if ((plan.steps[at] as JobStep).surprise) unlock("curveball");
          verifiedRef.current.add(plan.steps[at].title);
          stepCleared(at, plan.steps.length);
        }
      } catch {
        // The next look tries again.
      } finally {
        inFlight.current--;
      }
    },
    [plan, capture, task, level, current, teach, speak, stepCleared, award, unlock, refPhoto]
  );
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // Instant, on the phone, no AI: is the camera moving or too dark? The moment they hold still, Ray looks.
  useEffect(() => {
    if (phase !== "guiding") return;
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 24;
    const g = c.getContext("2d", { willReadFrequently: true });
    let prev: Uint8ClampedArray | null = null;
    let lastMove = 0;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (!g || !v || !v.videoWidth) return;
      g.drawImage(v, 0, 0, 32, 24);
      const d = g.getImageData(0, 0, 32, 24).data;
      const n = d.length / 4;
      const now = new Uint8ClampedArray(n);
      let sum = 0;
      let diff = 0;
      for (let k = 0; k < n; k++) {
        const y = (d[k * 4] * 3 + d[k * 4 + 1] * 4 + d[k * 4 + 2]) >> 3;
        now[k] = y;
        sum += y;
        if (prev) diff += Math.abs(y - prev[k]);
      }
      if (prev && diff / n > 26) lastMove = Date.now(); // real movement, not hand shake
      prev = now;
      const moving = Date.now() - lastMove < 500;
      const dark = sum / n < 35;
      if (moving !== movingRef.current) {
        movingRef.current = moving;
        if (!moving) tickRef.current(null);
      }
      setCam((x) => (x.dark === dark && x.moving === moving ? x : { dark, moving }));
    }, 250);
    return () => {
      clearInterval(id);
      movingRef.current = false;
      setCam({ dark: false, moving: false });
    };
  }, [phase]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  // Done with a step (button or "next"): Ray says the next one right away.
  const markDone = useCallback(() => {
    if (!plan) return;
    const next = plan.steps[current + 1];
    if ((plan.steps[current] as JobStep).surprise) unlock("curveball");
    stepCleared(current, plan.steps.length);
    if (next) speak(`Nice. Step ${current + 2}: ${next.instruction}`);
  }, [plan, current, stepCleared, speak, unlock]);

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
      body: JSON.stringify({ plan, level, minutes: (Date.now() - startedAt.current) / 60000, mistakes, questions: questionsRef.current, redone: redoneRef.current, surprises: surprisesRef.current }),
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
      `Verified by Ray: ${verifiedRef.current.size} of ${plan.steps.length} steps checked on camera`,
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
    setCert((c) => {
      // A job counts toward the certificate only if Ray saw at least half its steps done on camera.
      const counts = plan ? verifiedRef.current.size * 2 >= plan.steps.length : false;
      const n = { jobs: c.jobs + (counts ? 1 : 0), verified: c.verified + verifiedRef.current.size, minutes: c.minutes + Math.max(1, Math.round(elapsed / 60)) };
      try {
        localStorage.setItem("ra.cert", JSON.stringify(n));
      } catch {}
      return n;
    });
    const end = capture();
    const shots = end ? [...shotsRef.current, end].slice(-8) : shotsRef.current;
    if (!jobBefores.length && shots.length >= 2) {
      setBefores(shots);
      try {
        localStorage.setItem("ra.befores", JSON.stringify(shots));
      } catch {}
    }
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
      stopSpeaking();
      stopEar();
      const r = new Ctor();
      r.lang = "en-US";
      r.interimResults = false;
      r.continuous = false;
      r.onresult = (e) => {
        const text = Array.from(e.results).map((x) => x[0].transcript).join(" ").trim();
        if (!text) return;
        if (mode === "task") {
          setTask(text);
          begin(text);
        }
        else if (mode === "identify") {
          setTask(text);
          lookAt(text);
        } else {
          questionsRef.current = [...questionsRef.current, text].slice(-12);
          talkRef.current = [...talkRef.current, { who: "you" as const, text }].slice(-12);
          speak(FILLERS[Math.floor(Math.random() * FILLERS.length)], { filler: true });
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
    if (!found) return;
    const known = { product: { name: found.name, model: null, serial: null }, trade: "", tools: found.tools.map((t) => ({ ...t, need: true })) };
    // After a parts check with before photos: put it back together from them.
    if (foundMode === "parts" && befores.length) {
      setTask(REBUILD);
      return begin(REBUILD, known, befores);
    }
    const m = found.missions[0];
    if (!m) return;
    setTask(m.task);
    begin(m.task, known);
  }, [found, foundMode, befores, begin]);

  // Hands-free is on for every screen after the first tap (the tap is what lets the browser open the mic).
  useEffect(() => {
    handsFreeRef.current = handsFree;
    screenEarRef.current = phase !== "planning";
    earWantedRef.current = handsFree && armedRef.current && screenEarRef.current;
    if (earWantedRef.current) startEar();
    else stopEar();
  }, [phase, handsFree, startEar, stopEar]);
  useEffect(() => {
    const onTap = () => {
      armedRef.current = true;
      if (blockedRef.current) {
        blockedRef.current = false;
        setNeedTap(false);
      }
      earWantedRef.current = handsFreeRef.current && screenEarRef.current;
      startEar(); // inside the tap, which is what phones need to open the mic
    };
    document.addEventListener("pointerdown", onTap, true);
    return () => document.removeEventListener("pointerdown", onTap, true);
  }, [startEar]);
  useEffect(() => () => stopEar(), [stopEar]);
  useEffect(() => {
    if (!looking || lookStage !== "thinking") return;
    const id = setInterval(() => setLookT((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [looking, lookStage]);
  // Minimal taps: a job handed over from the scan page (or home) starts on its own when the level is known.
  useEffect(() => {
    if (!picked || autoRef.current || phase !== "setup" || page === "level") return;
    autoRef.current = true;
    begin(picked.task);
  }, [picked, phase, page, begin]);
  useEffect(() => {
    if (!curveball) return;
    const id = setTimeout(() => setCurveball(null), 6000);
    return () => clearTimeout(id);
  }, [curveball]);
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
        if (text.trim().split(/\s+/).length < 2) return; // a stray word from the room, not a question
        questionsRef.current = [...questionsRef.current, text].slice(-12);
        talkRef.current = [...talkRef.current, { who: "you" as const, text }].slice(-12);
        speak(FILLERS[Math.floor(Math.random() * FILLERS.length)], { filler: true });
        unlock("asked");
        tick(text);
        return;
      }
      if (phase === "identify" && found && !looking) {
        if (said(text, SAY.fix)) return fixIt();
        if (said(text, SAY.look)) return void lookAt();
        if (said(text, SAY.repeat)) return speak(found.say);
        if (text.trim().split(/\s+/).length < 3) return; // chatter, not a description
        setTask(text);
        lookAt(text);
        return;
      }
      if (phase === "loadout") {
        if (/unplugged|it's off|its off|power is off/i.test(text)) return setUnplugged(true);
        if (said(text, SAY.go)) return plan ? go() : speak("Almost. I'm still mapping it out.");
        return;
      }
      if (phase === "setup") {
        const t = text.toLowerCase();
        if (page === "level") {
          const pick: Level | null = /never|new|first|no\b/.test(t) ? "newbie" : /few|some|little|couple|once|twice/.test(t) ? "intermediate" : /pro|lot|expert|advanced|all the time/.test(t) ? "advanced" : null;
          if (!pick) return;
          setLevel(pick);
          try {
            localStorage.setItem("ra.level", pick);
          } catch {}
          cue("coin");
          return setPage("point");
        }
        if (page === "point" && /screw|bolt|nut|washer|parts|pieces|which goes/.test(t)) return void lookAt(undefined, "parts");
        if (page === "point" && /what (is|am i|are)|look|identify|scan|no idea|don't know|dont know/.test(t)) return void lookAt();
        if (page === "point" && /i know|pick|list|jobs?$/.test(t)) return setPage("job");
        if (/^(back|go back)$/.test(t.trim())) return setPage(page === "job" ? "point" : "level");
        // On the job page (or when they clearly describe a problem), that's the job, in their words.
        // Short chatter from the room is ignored.
        const words = t.split(/\s+/).length;
        if ((page === "job" && words >= 3) || (page === "point" && words >= 4 && /fix|broke|stuck|leak|won't|wont|not working|isn't|help|trying/.test(t))) {
          setTask(text);
          begin(text);
        }
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
    <main ref={stageRef} className="fixed inset-0 overflow-hidden bg-ink text-bone select-none">
      <div className="hazard pointer-events-none absolute inset-x-0 top-0 z-20 h-1.5" />
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
        <div className={`relative grid h-14 w-14 flex-none place-items-center rounded-full border-2 border-bone ${speaking ? "ring-4 ring-[#22C55E]/70" : ""} ${phase === "guiding" ? "hidden" : ""}`}>
          <span className="block h-full w-full overflow-hidden rounded-full">
            <RayFace head talking={speaking} mood={safety || flash === "bad" ? "worried" : flash === "good" || phase === "done" ? "happy" : "ok"} look={0} />
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-bold">Ray <span className="font-normal text-white/60">· journeyman{kit && !live ? " · practice" : ""}</span></span>
            <span className="flex items-center gap-2">
              {phase === "guiding" && <span className="tabular-nums text-white/70">{mm}:{ss}</span>}
              {phase !== "planning" && (armedRef.current || phase !== "setup") && (
                <button
                  onClick={() => (needTap ? undefined : setHandsFree((h) => !h))}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold ${!handsFree ? "bg-white/10 text-white/50" : earOn && !speaking ? "bg-[#22C55E] text-black" : "bg-white/15"}`}
                  aria-label="Hands-free on or off"
                >
                  {!handsFree ? "🎧 Off" : needTap ? (
                    <span className="animate-pulse">👆 Tap to listen</span>
                  ) : earOn && !speaking ? (
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
          <div className={`mt-1 flex items-center gap-2 ${SHOW_XP ? "" : "hidden"}`}>
            <span className="bg-bone px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink">{lvl.name}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-hazard transition-all duration-700" style={{ width: `${Math.round(lvl.pct * 100)}%` }} />
            </div>
            <span className="font-mono text-xs font-bold tabular-nums text-hazard">{xp} XP</span>
          </div>
        </div>
      </div>

      {/* Combo */}
      {phase === "guiding" && combo >= 2 && SHOW_XP && (
        <div key={combo} className="absolute left-4 top-[8.25rem] animate-[pop_.4s_ease-out] rounded-full bg-gradient-to-r from-[#FF3D6E] to-[#FF6B1A] px-4 py-1.5 text-lg font-black shadow-xl">
          🔥 x{combo}
        </div>
      )}

      {/* Ray on the call, FaceTime style */}
      {phase === "guiding" && (
        <div className={`absolute right-4 top-24 h-40 w-28 overflow-hidden rounded-2xl border-2 shadow-2xl transition-colors ${speaking ? "border-[#22C55E]" : "border-white/25"}`}>
          <RayFace talking={speaking} mood={safety ? "worried" : flash === "good" || flash === null && combo >= 2 ? "happy" : flash === "bad" ? "worried" : "ok"} look={point ? (point.x - 0.5) * 2 : 0} />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5 text-[11px] font-bold">
            <span>Ray</span>
            {speaking && (
              <span className="flex h-3 items-end gap-[2px]">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="w-[3px] animate-[talk_.3s_ease-in-out_infinite_alternate] rounded-full bg-[#22C55E]" style={{ height: `${6 + (i % 2) * 5}px`, animationDelay: `${i * 0.07}s` }} />
                ))}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Live: what Ray sees right now */}
      {phase === "guiding" && (
        <div className="absolute left-4 top-24 flex max-w-[calc(100%-10.5rem)] items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-xs backdrop-blur">
          <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-red-500" />
          <span className="font-black tracking-wider">LIVE</span>
          <span key={sees ?? ""} className="truncate text-white/85 animate-[rise_.3s_ease-out]">{sees ? `· ${sees}` : "· Ray is watching"}</span>
        </div>
      )}
      {phase === "guiding" && (cam.dark || cam.moving) && !safety && (
        <div className="pointer-events-none absolute left-1/2 top-[38%] -translate-x-1/2 animate-[rise_.2s_ease-out] whitespace-nowrap rounded-full bg-black/65 px-5 py-2.5 text-lg font-extrabold backdrop-blur">
          {cam.dark ? "🔦 More light, Ray can't see" : "✋ Hold steady"}
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
      {nice && !SHOW_XP && (
        <div key={nice.key} onAnimationEnd={() => setNice(null)} className="pointer-events-none absolute inset-x-0 top-[34%] z-20 animate-[floatUp_1.6s_ease-out_forwards] text-center">
          <div className="font-display text-7xl uppercase text-bone drop-shadow-[0_4px_0_rgba(0,0,0,.6)]">{nice.word}</div>
        </div>
      )}
      {popup && !levelUp && SHOW_XP && (
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
      {toast && SHOW_XP && (
        <div key={toast} className="pointer-events-none absolute inset-x-6 top-28 animate-[dropIn_2.6s_ease-out_forwards] rounded-3xl border border-[#FFD23F]/50 bg-gradient-to-br from-[#2A1A05] to-[#120A02] p-4 shadow-[0_0_40px_rgba(255,210,63,.35)]">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#FFD23F]/15 text-5xl">{BADGES[toast].icon}</div>
            <div>
              <div className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#FFD23F]">Badge unlocked</div>
              <div className="text-2xl font-black">{BADGES[toast].name}</div>
              <div className="text-sm text-white/70">{BADGES[toast].why}</div>
            </div>
          </div>
        </div>
      )}

      {/* Level up */}
      {levelUp && SHOW_XP && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40">
          <div className="animate-[pop_.5s_ease-out] text-center">
            <div className="text-sm font-mono font-bold uppercase tracking-[0.3em] text-[#FFD23F]">Level up</div>
            <div className="mt-2 bg-gradient-to-r from-[#FFD23F] via-[#FF6B1A] to-[#FF3D6E] bg-clip-text text-5xl font-black text-transparent">{levelUp}</div>
          </div>
        </div>
      )}

      {/* Safety */}
      {phase === "guiding" && refPhoto(current) && (
        <button onClick={() => setZoom(refPhoto(current))} className="absolute right-4 top-[16rem] w-28 overflow-hidden rounded-2xl border-2 border-white shadow-2xl">
          <img src={`data:image/jpeg;base64,${refPhoto(current)}`} alt="How it looked before" className="h-24 w-full object-cover" />
          <span className="block bg-white py-1 text-center text-[11px] font-black uppercase tracking-wide text-black">How it looked</span>
        </button>
      )}
      {zoom && (
        <button onClick={() => setZoom(null)} className="absolute inset-0 z-30 bg-black/90 p-4">
          <img src={`data:image/jpeg;base64,${zoom}`} alt="How it looked before" className="h-full w-full object-contain" />
          <span className="absolute inset-x-0 top-6 text-center text-sm font-bold text-white/70">How it looked before · tap to close</span>
        </button>
      )}

      {curveball && phase === "guiding" && !safety && (
        <div key={curveball} className="absolute left-4 right-36 top-36 flex animate-[rise_.4s_ease-out] items-center gap-3 rounded-3xl bg-[#F59E0B] px-4 py-3 text-black shadow-2xl">
          <span className="text-4xl">🚧</span>
          <span>
            <span className="block text-xs font-black uppercase tracking-[0.2em]">Curveball</span>
            <span className="text-lg font-extrabold leading-tight">{curveball}</span>
          </span>
        </div>
      )}

      {safety && phase === "guiding" && (
        <div className="absolute left-4 right-36 top-36 flex items-center gap-3 rounded-3xl bg-red-600 px-4 py-3 text-lg font-extrabold leading-tight shadow-2xl animate-pulse">
          <span className="text-4xl">⚠️</span>
          {safety}
        </div>
      )}

      {/* SETUP, page 1: your level (asked once, then remembered) */}
      {phase === "setup" && page === "level" && (
        <div className="absolute inset-x-0 bottom-0 animate-[rise_.4s_ease-out] px-6 pb-10">
          <h1 className="font-display text-5xl uppercase leading-[0.92]">Have you done this before?</h1>
          <p className="mt-2 text-white/60">Ray goes at your speed.</p>
          <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
            {LEVEL_PICKS.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  setLevel(l.id);
                  try {
                    localStorage.setItem("ra.level", l.id);
                  } catch {}
                  cue("coin");
                  // A job handed over from the scan: go straight into it.
                  if (picked && !autoRef.current) {
                    autoRef.current = true;
                    begin(picked.task, undefined);
                  } else setPage("point");
                }}
                className="flex w-full items-center gap-4 py-5 text-left active:opacity-60"
              >
                <span className="text-4xl">{l.icon}</span>
                <span className="flex-1 font-display text-3xl uppercase tracking-wide">{l.hint}</span>
                <span className="text-2xl text-white/40">›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SETUP, page 2: point at it */}
      {phase === "setup" && page === "point" && (
        <div className="absolute inset-x-0 bottom-0 animate-[rise_.4s_ease-out] px-6 pb-10">
          <h1 className="font-display text-5xl uppercase leading-[0.92]">Point at what&apos;s broken.</h1>
          {(camError || error) && <p className="mt-3 text-sm text-red-300">{camError ?? error}</p>}
          {picked && (
            <button
              onClick={() => begin(picked.task)}
              className="mt-6 flex h-20 w-full items-center justify-between bg-hazard px-6 font-display text-3xl uppercase tracking-wide text-ink active:translate-y-0.5"
            >
              {picked.name} <span>→</span>
            </button>
          )}
          <button
            onClick={() => lookAt()}
            className={`mt-3 flex h-20 w-full items-center justify-between px-6 font-display text-[1.5rem] uppercase tracking-wide active:translate-y-0.5 ${picked ? "border-2 border-bone" : "mt-6 bg-hazard text-ink"}`}
          >
            What am I looking at? <span>→</span>
          </button>
          <div className="mt-5 divide-y divide-bone/15 border-y border-bone/15 font-mono text-sm uppercase tracking-[0.15em]">
            <button onClick={() => setPage("job")} className="flex w-full justify-between py-3.5 text-left active:opacity-60">
              I know what it is <span>→</span>
            </button>
            <button onClick={() => lookAt(undefined, "parts")} className="flex w-full justify-between py-3.5 text-left active:opacity-60">
              Sort my screws + parts <span>→</span>
            </button>
          </div>
          <button onClick={() => setPage("level")} className="mt-4 w-full text-center text-sm text-white/40">
            {LEVEL_PICKS.find((l) => l.id === level)?.icon} {LEVEL_PICKS.find((l) => l.id === level)?.name} · change
          </button>
        </div>
      )}

      {/* SETUP, page 3: pick the job, or say it */}
      {phase === "setup" && page === "job" && (
        <div className="absolute inset-x-0 bottom-0 animate-[rise_.4s_ease-out] px-6 pb-10">
          <button onClick={() => setPage("point")} className="mb-3 text-lg text-white/60">
            ‹ Back
          </button>
          <h1 className="font-display text-5xl uppercase leading-[0.92]">What&apos;s the job?</h1>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
          <div className="mt-5 divide-y divide-white/10 border-y border-white/10">
            {befores.length > 0 && (
              <button
                onClick={() => {
                  setTask(REBUILD);
                  begin(REBUILD, undefined, befores);
                }}
                className="flex w-full items-center gap-4 py-4 text-left active:opacity-60"
              >
                <span className="text-3xl">🔁</span>
                <span className="flex-1 leading-tight">
                  <span className="block font-display text-[1.65rem] uppercase leading-none tracking-wide">Put it back together</span>
                  <span className="text-sm text-white/55">Using your {befores.length} before photos</span>
                </span>
                <span className="flex -space-x-3">
                  {befores.slice(0, 3).map((b, i) => (
                    <img key={i} src={`data:image/jpeg;base64,${b}`} alt="" className="h-10 w-10 rounded-full border-2 border-[#07070A] object-cover" />
                  ))}
                </span>
              </button>
            )}
            <button onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-4 py-4 text-left active:opacity-60">
              <span className="text-3xl">📸</span>
              <span className="flex-1 leading-tight">
                <span className="block font-display text-[1.65rem] uppercase leading-none tracking-wide">{befores.length ? "New before photos" : "Add before photos"}</span>
                <span className="text-sm text-white/55">Took it apart? Ray puts it back the way it was</span>
              </span>
            </button>
            {MISSIONS.map((m) => (
              <button
                key={m.title}
                onClick={() => {
                  setTask(m.task);
                  begin(m.task);
                }}
                className="flex w-full items-center gap-4 py-4 text-left active:opacity-60"
              >
                <span className="text-3xl">{m.icon}</span>
                <span className="flex-1 font-display text-[1.65rem] uppercase leading-none tracking-wide">{m.title}</span>
                {SHOW_XP && <span className="text-sm font-bold text-[#FFD23F]">+{m.xp} XP</span>}
              </button>
            ))}
          </div>
          <form
            className="mt-5 flex items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (task.trim()) begin(task.trim());
            }}
          >
            <button type="button" onClick={() => listen("task")} className={`grid h-14 w-14 flex-none place-items-center rounded-full text-2xl ${listening ? "animate-pulse bg-[#FF6B1A]" : "bg-white text-black"}`} aria-label="Say it">
              🎙️
            </button>
            <input
              value={MISSIONS.some((m) => m.task === task) ? "" : task}
              onChange={(e) => setTask(e.target.value)}
              className="min-w-0 flex-1 border-b border-white/25 bg-transparent py-2 text-lg outline-none placeholder:text-white/45"
              placeholder="Say it, or where you're stuck"
            />
          </form>
        </div>
      )}

      {/* What hands-free heard (on screens without the guiding caption) */}
      {heard && phase !== "guiding" && phase !== "setup" && (
        <div className="absolute inset-x-4 top-[5.25rem] z-10 flex justify-end">
          <div className="max-w-[85%] animate-[rise_.3s_ease-out] rounded-2xl rounded-br-md bg-white px-4 py-2 text-sm font-semibold text-black shadow-xl">“{heard}”</div>
        </div>
      )}

      {/* IDENTIFY: labels on the parts, where to start */}
      {phase === "identify" && looking && lookStage === "hold" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="relative grid h-44 w-44 place-items-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
              <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(242,237,228,.25)" strokeWidth="6" />
              <circle cx="50" cy="50" r="46" fill="none" stroke="#FF5F00" strokeWidth="6" strokeDasharray="289" strokeDashoffset="289" className="animate-[fillring_1.1s_linear_forwards]" />
            </svg>
            <div className="text-center">
              <div className="font-display text-4xl uppercase leading-none">Hold still</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.2em] text-bone/70">Whole thing in frame</div>
            </div>
          </div>
        </div>
      )}
      {phase === "identify" && looking && lookStage === "thinking" && (
        <>
          <div className="pointer-events-none absolute inset-x-6 h-1 animate-[scan_2.4s_ease-in-out_infinite] rounded-full bg-hazard shadow-[0_0_30px_8px_rgba(255,95,0,.55)]" />
          <div className="absolute inset-x-0 bottom-0 bg-ink/90 p-6 pb-10">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#22C55E]">✓ Got the shot. You can relax.</div>
            <div className="mt-2 font-display text-4xl uppercase leading-none">
              {lookT < 3 ? "Looking at it…" : lookT < 6 ? "Naming the parts…" : lookT < 10 ? "Finding where to start…" : "Almost there…"}
            </div>
            <div className="mt-4 h-1.5 w-full bg-bone/15">
              <div className="h-full bg-hazard transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(95, (lookT / 12) * 100)}%` }} />
            </div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.15em] text-bone/50">About {Math.max(1, 12 - lookT)} sec</div>
          </div>
        </>
      )}
      {/* The ONE thing to look at first: a big ring, easy to follow */}
      {phase === "identify" &&
        found?.focus &&
        !showAll &&
        (() => {
          const at = onSnap(found.focus.x, found.focus.y);
          if (!at) return null;
          return (
            <button onClick={() => found.focus && speak(`${found.focus.label}. ${found.focus.why}`)} className="absolute animate-[pop_.4s_ease-out] transition-all duration-700 ease-out" style={{ left: at.left, top: at.top }}>
              <span className="absolute -left-12 -top-12 h-24 w-24 animate-ping rounded-full border-[5px] border-[#FF6B1A] opacity-50" />
              <span className="absolute -left-10 -top-10 h-20 w-20 rounded-full border-[5px] border-[#FF6B1A] shadow-[0_0_30px_#FF6B1A]" />
              <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-[#FF6B1A]" />
              <span className="absolute left-0 top-12 -translate-x-1/2 whitespace-nowrap rounded-2xl bg-[#FF6B1A] px-4 py-2 text-lg font-black shadow-xl">👉 {found.focus.label}</span>
            </button>
          );
        })()}
      {phase === "identify" &&
        (showAll || !found?.focus) &&
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
                  {foundMode === "parts" && <div className="mb-1 text-xs font-mono font-bold uppercase tracking-[0.25em] text-[#FFB38A]">🔩 Your parts</div>}
                  <h1 className="font-display text-4xl uppercase leading-[0.95]">{found.name}</h1>
                  {found.state && (
                    <div className="mt-2 inline-flex items-center gap-2 bg-hazard px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-ink">⚠ {found.state}</div>
                  )}
                  <p className="mt-1.5 text-white/70">{found.what}</p>
                  {found.focus && (
                    <p className="mt-3 text-lg font-extrabold leading-snug">
                      👉 Look here first: <span className="text-[#FF8A3D]">{found.focus.label}</span>
                      <span className="block text-base font-semibold text-white/70">{found.focus.why}</span>
                    </p>
                  )}
                  {found.parts.length > 1 && (
                    <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-sm font-bold text-white/50 underline">
                      {showAll ? "Just the main thing" : `Show all ${found.parts.length} parts`}
                    </button>
                  )}
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
              <div className="mt-4 text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#FFB38A]">You&apos;ll need</div>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {found.tools.map((t, i) => (
                  <div key={i} className="flex-none rounded-2xl bg-white/10 px-3 py-2 text-center">
                    <div className="text-3xl">{t.icon}</div>
                    <div className="mt-0.5 text-xs font-bold">{t.name}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#FFB38A]">{foundMode === "parts" ? "Putting them back" : "Start here"}</div>
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
                  className="mt-5 flex h-16 w-full items-center justify-between gap-2 px-6 text-left bg-hazard text-ink font-display uppercase tracking-wide text-xl font-black active:scale-[.98]"
                >
                  {foundMode === "parts" ? "Put it back together" : found.missions[0]?.title ?? "Fix it with Ray"} <span>→</span>
                </button>
              )}
              {foundMode === "parts" && showAll && found.parts.length > 0 && (
                <ul className="mt-4 space-y-1.5 text-sm">
                  {found.parts.map((p, i) => (
                    <li key={i} className="flex gap-2" onClick={() => speak(`${p.label}. ${p.what}`)}>
                      <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-[#FF6B1A] text-xs font-black">{i + 1}</span>
                      <span>
                        <span className="font-bold">{p.label}</span> <span className="text-white/65">{p.what}</span>
                      </span>
                    </li>
                  ))}
                </ul>
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
                stopSpeaking();
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
          <div className="mx-auto mb-5 h-24 w-24 animate-bounce overflow-hidden rounded-full border-2 border-bone">
            <RayFace head talking mood="happy" look={0} />
          </div>
          <div className="font-display text-4xl uppercase">Ray is picking up…</div>
          <div className="mt-1 text-white/70">{scanLabel ? "Reading the label, sizing up the job" : "Sizing up the job"}</div>
          <div className="mx-auto mt-5 max-w-xs rounded-2xl bg-white/10 px-4 py-3 text-sm text-white/80">💡 Pro tip: {["Unplug first. Always.", "Read the data plate before you diagnose anything.", "Most no-cool calls are airflow, not refrigerant.", "Gloves on before your hands go behind a unit."][Math.floor(Date.now() / 4000) % 4]}</div>
        </div>
      )}

      {/* LOADOUT: the tools for this job */}
      {phase === "loadout" && kit && (
        <div className="absolute inset-0 overflow-y-auto bg-black/75 p-6 pt-24 backdrop-blur-md">
          <div className="text-xs font-mono font-bold uppercase tracking-[0.3em] text-[#FFB38A]">Loadout</div>
          <h1 className="mt-1 font-display text-5xl uppercase leading-none">Grab your gear</h1>
          <div className="mt-1 text-white/60">
            {kit.product.name}
            {kit.product.model ? ` · ${kit.product.model}` : ""} · {LEVEL_PICKS.find((l) => l.id === level)?.icon} {LEVEL_PICKS.find((l) => l.id === level)?.name}
            {plan ? ` · ${plan.steps.length} steps${current > 0 ? ` · picking up at step ${current + 1}` : ""}` : ""}
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
                  {"need" in t && <div className={`mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.15em] ${t.need ? "text-hazard" : "text-bone/45"}`}>{t.need ? "Must have" : "Optional"}</div>}
                  <div className={`absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-lg font-black ${on ? "bg-[#22C55E]" : "bg-white/15"}`}>{on ? "✓" : ""}</div>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-center text-sm text-white/55">
            {gear.size}/{kit.tools.length} ready
            {handsFree && <div className="mt-1 text-white/45">Say “let&apos;s go” when you&apos;re ready</div>}
          </div>
          {plan?.hazards?.length ? (
            <div className="mt-5 border-y border-hazard/40 py-3">
              <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-hazard">⚠ Safety on this job</div>
              <button
                onClick={() => setUnplugged((u) => !u)}
                className={`mt-2 flex w-full items-center justify-between px-3 py-2.5 font-display text-lg uppercase tracking-wide ${unplugged ? "bg-[#22C55E] text-ink" : "border-2 border-hazard text-bone"}`}
              >
                ⚡ It&apos;s unplugged <span>{unplugged ? "✓" : "tap to confirm"}</span>
              </button>
              <ul className="mt-2 space-y-1.5">
                {plan.hazards.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm font-semibold">
                    <span>{h.icon}</span>
                    <span>{h.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {plan ? (
            <button onClick={go} className="mt-5 h-16 w-full animate-[pop_.4s_ease-out] bg-hazard text-ink font-display uppercase tracking-wide text-xl font-black active:scale-[.98]">
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
          <div className="flex items-center gap-4" onClick={() => setShowSteps(true)}>
            <div
              className="grid h-24 w-24 flex-none place-items-center rounded-full p-1.5"
              style={{ background: `conic-gradient(${ORANGE} ${(current / plan.steps.length) * 360}deg, rgba(255,255,255,.15) 0deg)` }}
            >
              <div key={current} className="grid h-full w-full animate-[pop_.4s_ease-out] place-items-center rounded-full bg-[#121216] text-5xl">{step.icon}</div>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#FFB38A]">
                Step {current + 1} / {plan.steps.length}{" "}
                {(step as JobStep).surprise ? <span className="text-[#F59E0B]">· 🚧 Curveball</span> : null}
              </div>
              <div className="font-display text-[2.1rem] uppercase leading-[0.95]">{step.title}</div>
            </div>
          </div>
          <div className={`mt-4 grid gap-2.5 ${handsFree ? "grid-cols-4" : "grid-cols-5"}`}>
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
            {!handsFree && (
            <button onClick={() => listen("ask")} className={`col-span-2 grid h-20 place-items-center rounded-3xl text-3xl active:scale-95 ${listening ? "bg-[#FF6B1A] animate-pulse" : "bg-white text-black"}`} aria-label="Ask Ray">
              {listening ? "👂" : "🎙️"}
            </button>
            )}
            <button onClick={markDone} className={`${handsFree ? "col-span-2" : ""} grid h-20 place-items-center rounded-3xl bg-[#22C55E] text-3xl shadow-[0_8px_24px_rgba(34,197,94,.45)] active:scale-95`} aria-label="Done with this step">
              ✓
            </button>
          </div>
          <p className="mt-3 text-center text-sm text-white/50">{handsFree ? "Just talk. Say “next” when it’s done." : "Tap 🎙️ to ask Ray"}</p>
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
                <span className={`grid h-11 w-11 flex-none place-items-center rounded-full text-xl ${i < current ? "bg-[#22C55E]" : i === current ? "bg-[#FF6B1A]" : (s as JobStep).surprise ? "bg-[#F59E0B]/40" : "bg-white/10"}`}>{i < current ? "✓" : (s as JobStep).surprise ? "🚧" : s.icon}</span>
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
            <div className="text-xs font-mono font-bold uppercase tracking-[0.3em] text-[#22C55E]">Mission complete</div>
            <div className="mt-3 text-6xl tracking-widest">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`inline-block animate-[pop_.5s_ease-out] ${i < stars ? "text-[#FFD23F] drop-shadow-[0_0_12px_rgba(255,210,63,.7)]" : "text-white/15"}`} style={{ animationDelay: `${i * 0.25}s` }}>
                  ★
                </span>
              ))}
            </div>
            <h1 className="mt-3 font-display text-4xl uppercase leading-[0.95]">{plan.product.name}</h1>
            <div className="mt-1 text-white/60">
              {plan.steps.length} steps · {mm}:{ss} · {mistakes.length} {mistakes.length === 1 ? "mistake" : "mistakes"}
            </div>
            {SHOW_XP && <div className="mt-6 text-7xl font-black text-[#FFD23F]">+{jobXp}</div>}
            {SHOW_XP && <div className="text-sm font-bold uppercase tracking-widest text-white/60">XP earned · TradesQuest</div>}
            <div className={`mx-auto mt-4 max-w-sm ${SHOW_XP ? "" : "hidden"}`}>
              <div className="flex justify-between text-xs font-bold">
                <span>{lvl.name}</span>
                <span className="text-white/50">{lvl.next - xp} XP to next</span>
              </div>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/15">
                <div className="h-full rounded-full bg-gradient-to-r from-[#FFD23F] via-[#FF6B1A] to-[#FF3D6E] transition-all duration-1000" style={{ width: `${Math.round(lvl.pct * 100)}%` }} />
              </div>
            </div>
          </div>
          {/* Proof, not just points: what Ray saw on camera, and where it leads */}
          <div className="mt-8 border-y border-bone/15 py-5">
            <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-[#22C55E]">✓ Verified on camera</div>
            <div className="mt-1 font-display text-4xl uppercase leading-none">
              Ray checked {verifiedRef.current.size} of {plan.steps.length} steps
            </div>
            <div className="mt-5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-hazard">Certificate track · Appliance + HVAC-R Tech I</div>
            <div className="mt-2 h-2 w-full bg-bone/15">
              <div className="h-full bg-hazard transition-all duration-1000" style={{ width: `${Math.min(100, (Math.min(cert.jobs, 10) / 10) * 100)}%` }} />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11px] uppercase tracking-wider text-bone/60">
              <span>{Math.min(cert.jobs, 10)} / 10 verified jobs</span>
              <span>{cert.minutes < 60 ? `${cert.minutes} min` : `${(cert.minutes / 60).toFixed(1)} hrs`} / 40 hrs</span>
            </div>
            <p className="mt-3 text-sm text-bone/70">A job counts when Ray checks at least half of it on camera. Learn at home. Get hired.</p>
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
                <h3 className="mt-5 text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#FFB38A]">What I learned</h3>
                <ul className="mt-2 space-y-1.5">
                  {report.learned.map((x, i) => (
                    <li key={i} className="flex gap-2">
                      <span>💡</span>
                      <span>{x}</span>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-5 text-xs font-mono font-bold uppercase tracking-[0.2em] text-[#FFB38A]">Teach it to someone</h3>
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
                setPage("point");
                setPhase("setup");
                setPlan(null);
                setKit(null);
                setReport(null);
                setCaption(null);
              }}
              className="h-16 bg-hazard text-ink font-display uppercase tracking-wide text-xl font-black"
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
