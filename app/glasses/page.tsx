"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import GlassesOverlay, { type OverlayPart, type OverlayAnomaly } from "@/components/GlassesOverlay";
import { PARTS, byLabel } from "@/lib/parts";
import { MotionTracker } from "@/lib/motion";
import ScanDrawer, { type Mode } from "@/components/ScanDrawer";
import type { FixPlan, FixWatch, Replan } from "@/lib/fix";

/**
 * Glasses view: live camera, every known part tinted in its color and labeled.
 * Fast loop: boxes every ~1.2 s. Slow loop: pixel masks when they arrive, merged onto the same labels.
 */
export default function GlassesPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0, vw: 0, vh: 0 });
  const [parts, setParts] = useState<OverlayPart[]>([]);
  const masks = useRef<Map<string, { mask: string; box: [number, number, number, number]; at: number }>>(new Map());
  const [status, setStatus] = useState("Starting camera…");
  const [ms, setMs] = useState<{ box: number; mask: number }>({ box: 0, mask: 0 });
  const [useMasks, setUseMasks] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const tracker = useRef<MotionTracker | null>(null);
  const captureTotal = useRef({ x: 0, y: 0 }); // tracker.total at the moment the last *applied* detection frame was grabbed
  const pendingTotal = useRef({ x: 0, y: 0 }); // tracker.total when the in-flight frame was grabbed
  const [drift, setDrift] = useState({ dx: 0, dy: 0 });
  const [tracking, setTracking] = useState(true);
  const trackingRef = useRef(tracking);
  trackingRef.current = tracking;
  // drawer modes
  const [mode, setMode] = useState<Mode>("parts");
  const [tourIndex, setTourIndex] = useState(0);
  const [plan, setPlan] = useState<FixPlan | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [planning, setPlanning] = useState(false);
  const [lastSay, setLastSay] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const problemRef = useRef(problem); problemRef.current = problem;
  const historyRef = useRef<string[]>([]);
  const [anomalies, setAnomalies] = useState<OverlayAnomaly[]>([]);
  const [looking, setLooking] = useState(false);
  const replannedStep = useRef(-1); // step index we already re-planned from (one re-plan per step)
  const [listening, setListening] = useState(false);
  const modeRef = useRef(mode); modeRef.current = mode;
  const planRef = useRef(plan); planRef.current = plan;
  const stepRef = useRef(stepIndex); stepRef.current = stepIndex;
  const userSaidRef = useRef<string | null>(null);
  const useMasksRef = useRef(useMasks);
  const pausedRef = useRef(paused);
  useMasksRef.current = useMasks;
  pausedRef.current = paused;

  // camera
  const [needTap, setNeedTap] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const startCamera = useCallback(async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play().catch(() => {}); // an interrupted play() is harmless; the stream still shows
      setNeedTap(false);
      setStatus("Looking…");
      return true;
    } catch (e) {
      console.warn("camera:", (e as Error).name);
      return false;
    }
  }, []);

  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    (async () => {
      if (await startCamera()) return;
      const forcedStill = new URLSearchParams(window.location.search).get("still");
      const isPhone = !forcedStill && (/iPhone|iPad|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1);
      if (isPhone) {
        // iPhone Safari sometimes wants a tap before it hands over the camera. Ask for one instead of guessing.
        setNeedTap(true);
        setStatus("Camera needs a tap");
        return;
      }
      // Desktop with no camera: run on a still demo photo so the whole pipeline still works.
      const still = new URLSearchParams(window.location.search).get("still") || "/demo/cooler-back.jpg";
      const im = new Image();
      im.onload = async () => {
        const c = document.createElement("canvas");
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const ctx = c.getContext("2d")!;
        const t0 = Date.now();
        const paint = () => {
          const t = (Date.now() - t0) / 1000;
          ctx.fillStyle = "#111"; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(im, Math.sin(t / 2) * c.width * 0.06, Math.cos(t / 3) * c.height * 0.03);
        };
        paint();
        const iv = setInterval(paint, 33);
        const stream = c.captureStream(30);
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setStatus("Demo photo (no camera)");
        v.addEventListener("emptied", () => clearInterval(iv), { once: true });
      };
      im.onerror = () => setErr("Camera blocked. Allow camera access and reload.");
      im.src = still;
    })();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [startCamera]);

  // size
  useEffect(() => {
    const upd = () => {
      const el = wrapRef.current, v = videoRef.current;
      if (!el || !v) return;
      setView({ w: el.clientWidth, h: el.clientHeight, vw: v.videoWidth, vh: v.videoHeight });
    };
    upd();
    const ro = new ResizeObserver(upd);
    if (wrapRef.current) ro.observe(wrapRef.current);
    videoRef.current?.addEventListener("loadedmetadata", upd);
    return () => ro.disconnect();
  }, []);

  const grab = useCallback((maxSide: number, q: number): string | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const s = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * s);
    c.height = Math.round(v.videoHeight * s);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q).split(",")[1] ?? null;
  }, []);

  // Steady labels: a part that vanishes for ONE detection stays on screen (no flicker); a part whose box
  // moved a little slides to the new spot instead of jumping; a brand-new part must be seen twice before it shows.
  const history = useRef<Map<string, { box: [number, number, number, number]; hits: number; misses: number }>>(new Map());
  const stabilize = useCallback((fresh: OverlayPart[]): OverlayPart[] => {
    const h = history.current;
    const seenNow = new Set(fresh.map((p) => p.label));
    for (const p of fresh) {
      const e = h.get(p.label);
      if (!e) h.set(p.label, { box: p.box, hits: 1, misses: 0 });
      else {
        const k = 0.75; // most of the way toward the new box; the overlay glides the rest
        e.box = e.box.map((v, i) => v + (p.box[i] - v) * k) as [number, number, number, number];
        e.hits++; e.misses = 0;
      }
    }
    for (const [label, e] of h) {
      if (!seenNow.has(label)) { e.misses++; if (e.misses > 2) h.delete(label); }
    }
    const out: OverlayPart[] = [];
    for (const [label, e] of h) {
      if (e.hits < 2) continue; // need two sightings before it appears
      const def = byLabel(label);
      if (def) out.push({ label, color: def.color, box: e.box });
    }
    return out;
  }, []);

  const merge = useCallback((boxesRaw: OverlayPart[]) => {
    const boxes = stabilize(boxesRaw);
    const now = Date.now();
    const out = boxes.map((b) => {
      const m = masks.current.get(b.label);
      if (!m || now - m.at > 8000) return b;
      // a mask is only valid near the box it was cut from
      const dx = Math.abs((m.box[0] + m.box[2]) / 2 - (b.box[0] + b.box[2]) / 2);
      const dy = Math.abs((m.box[1] + m.box[3]) / 2 - (b.box[1] + b.box[3]) / 2);
      if (dx > 0.08 || dy > 0.08) return b;
      return { ...b, mask: m.mask };
    });
    setParts(out);
    setSeen((s) => {
      const n = new Set(s);
      out.forEach((p) => n.add(p.label));
      return n;
    });
  }, [stabilize]);

  // motion loop: keep labels glued to the parts between detections
  useEffect(() => {
    tracker.current = new MotionTracker();
    let raf = 0;
    const tick = () => {
      const v = videoRef.current, t = tracker.current;
      if (v && t && v.readyState >= 2 && !pausedRef.current) {
        t.step(v);
        if (trackingRef.current) {
          // Picture moved right by dx => the part is now further right on screen => shift labels by +dx.
          const d = { dx: t.total.x - captureTotal.current.x, dy: t.total.y - captureTotal.current.y };
          setDrift(d);
          (window as unknown as { __glasses?: object }).__glasses = { drift: d, total: { ...t.total }, lost: t.lost };
        } else setDrift({ dx: 0, dy: 0 });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // fast loop: boxes
  useEffect(() => {
    let stop = false;
    let lastBoxes: OverlayPart[] = [];
    const loop = async () => {
      while (!stop) {
        if (pausedRef.current) { await new Promise((r) => setTimeout(r, 200)); continue; }
        const frame = grab(640, 0.65);
        if (!frame) { await new Promise((r) => setTimeout(r, 200)); continue; }
        pendingTotal.current = { ...(tracker.current?.total ?? { x: 0, y: 0 }) };
        const t0 = Date.now();
        try {
          const res = await fetch("/api/parts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frame, mode: "boxes" }) });
          const j = (await res.json()) as { parts?: OverlayPart[]; error?: string };
          if (j.error) throw new Error(j.error);
          lastBoxes = j.parts ?? [];
          captureTotal.current = pendingTotal.current;
          merge(lastBoxes);
          setMs((m) => ({ ...m, box: Date.now() - t0 }));
          setErr(null);
          setStatus(lastBoxes.length ? `${lastBoxes.length} parts in view` : "Point me at the cooler");
        } catch (e) {
          setErr(String((e as Error).message || e));
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    };
    loop();
    return () => { stop = true; };
  }, [grab, merge]);

  // slow loop: masks
  useEffect(() => {
    let stop = false;
    const loop = async () => {
      while (!stop) {
        if (!useMasksRef.current || pausedRef.current) { await new Promise((r) => setTimeout(r, 300)); continue; }
        const frame = grab(768, 0.7);
        if (!frame) { await new Promise((r) => setTimeout(r, 300)); continue; }
        const t0 = Date.now();
        try {
          const res = await fetch("/api/parts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frame, mode: "masks" }) });
          const j = (await res.json()) as { parts?: OverlayPart[]; error?: string };
          if (!j.error) {
            const now = Date.now();
            for (const p of j.parts ?? []) if (p.mask) masks.current.set(p.label, { mask: p.mask, box: p.box, at: now });
            setMs((m) => ({ ...m, mask: Date.now() - t0 }));
            setParts((cur) => cur.map((b) => {
              const m = masks.current.get(b.label);
              return m ? { ...b, mask: m.mask, box: m.box } : b;
            }));
          }
        } catch { /* masks are optional */ }
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    loop();
    return () => { stop = true; };
  }, [grab]);

  const speak = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    const voices = window.speechSynthesis.getVoices();
    const pick = voices.find((v) => /Samantha|Daniel|Google US English|Karen|Alex/i.test(v.name)) ?? voices[0];
    if (pick) u.voice = pick;
    window.speechSynthesis.speak(u);
  };

  // Tour: say each stop as you reach it
  useEffect(() => {
    if (mode !== "tour") return;
    const d = PARTS[tourIndex];
    setSelected(d.label);
    speak(`${d.label}. ${d.says}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tourIndex]);

  // Fix: say each step as you reach it
  useEffect(() => {
    if (mode !== "fix" || !plan) return;
    const st = plan.steps[stepIndex];
    if (!st) return;
    setLastSay(null); setAnomalies([]);
    if (stepIndex === 0) replannedStep.current = -1;
    speak(stepIndex === 0 ? `${plan.intro} ${plan.diagnosis} First: ${st.instruction}` : `${st.title}. ${st.instruction}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, plan, stepIndex]);

  // Fix: every look, the newest frame goes to the smart model with the whole story so far.
  // It can mark anomalies on screen, change the next steps, ask for a closer view, or mark the step done.
  useEffect(() => {
    let stop = false;
    const loop = async () => {
      while (!stop) {
        await new Promise((r) => setTimeout(r, 1200));
        const pl = planRef.current;
        if (modeRef.current !== "fix" || !pl || pausedRef.current) continue;
        if (typeof window !== "undefined" && window.speechSynthesis?.speaking && !userSaidRef.current) continue;
        const frame = grab(768, 0.7);
        if (!frame) continue;
        const idx = stepRef.current;
        const said = userSaidRef.current; userSaidRef.current = null;
        setLooking(true);
        try {
          const res = await fetch("/api/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "watch", frame, problem: problemRef.current, plan: pl, current: idx, history: historyRef.current, userSaid: said }) });
          const w = (await res.json()) as FixWatch & { error?: string };
          if (w.error) continue;
          historyRef.current = [...historyRef.current, w.see].slice(-6);
          setAnomalies(w.anomalies.map((an) => ({ part: an.part, issue: an.issue, box: [an.box_2d[1] / 1000, an.box_2d[0] / 1000, an.box_2d[3] / 1000, an.box_2d[2] / 1000] as [number, number, number, number] })));
          if (w.anomalies.length && replannedStep.current !== idx && stepRef.current === idx) {
            // Something looks wrong: hand the frame and the whole story to the smart model to re-plan.
            replannedStep.current = idx;
            setLastSay(`I see ${w.anomalies.map((an) => an.issue).join(", and ")}. Let me think about what to do.`);
            speak(`I see ${w.anomalies.map((an) => an.issue).join(", and ")}. Give me a second.`);
            try {
              const r2 = await fetch("/api/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "replan", frame, problem: problemRef.current, plan: pl, current: idx, history: historyRef.current, anomalies: w.anomalies }) });
              const rp = (await r2.json()) as Replan & { error?: string };
              if (!rp.error && rp.remainingSteps.length && stepRef.current === idx) {
                setPlan({ ...pl, steps: [...pl.steps.slice(0, idx + 1), ...rp.remainingSteps] });
                historyRef.current = [...historyRef.current, `Re-planned: ${rp.verdict}`].slice(-6);
                setLastSay(rp.say); speak(rp.say);
                setStepIndex(idx + 1);
              }
            } catch { /* keep the old plan */ }
            continue;
          }
          if (w.safety) { setLastSay(w.safety); speak(w.safety); continue; }
          const line = w.say ?? (w.anomalies.length ? `I see ${w.anomalies.map((an) => an.issue).join(", and ")}.` : null) ?? w.aim;
          if (line) { setLastSay(line); speak(line); }
          if (w.stepDone && stepRef.current === idx && idx < pl.steps.length - 1) setStepIndex(idx + 1);
        } catch { /* try again next tick */ } finally { setLooking(false); }
      }
    };
    loop();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grab]);

  const onPlan = async (problem: string) => {
    if (!problem) { setPlan(null); setStepIndex(0); setSelected(null); setAnomalies([]); historyRef.current = []; return; }
    setProblem(problem); historyRef.current = []; setAnomalies([]);
    setPlanning(true);
    setErr(null);
    try {
      const frame = grab(640, 0.6);
      const res = await fetch("/api/fix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "plan", problem, frame }) });
      const j = (await res.json()) as FixPlan & { error?: string };
      if (j.error) throw new Error(j.error);
      setPlan(j);
      setStepIndex(0);
    } catch (e) {
      setErr("Ray couldn't make a plan: " + String((e as Error).message || e));
    } finally {
      setPlanning(false);
    }
  };

  type Recognition = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };
  const onMic = () => {
    const W = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setErr("Voice input isn't available in this browser. Type instead."); return; }
    window.speechSynthesis?.cancel();
    const r = new Ctor();
    r.lang = "en-US"; r.interimResults = false;
    setListening(true);
    r.onresult = (e) => {
      const text = e.results[0][0].transcript;
      if (planRef.current) userSaidRef.current = text; // a question mid-job
      else onPlan(text); // describing the problem
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
  };

  const onTap = (label: string | null) => {
    setSelected(label);
    if (!label) return;
    const def = byLabel(label);
    if (def) speak(def.says);
  };

  // What gets drawn: in Fix mode only the current step's parts; with a selection only that part; otherwise everything.
  const stepParts = mode === "fix" && plan ? new Set(plan.steps[stepIndex]?.parts ?? []) : null;
  const visibleParts = selected && mode !== "fix" ? parts.filter((p) => p.label === selected) : parts;
  const inView = new Set(parts.map((p) => p.label));

  return (
    <main className="h-dvh w-screen bg-black text-white overflow-hidden relative select-none">
      <div ref={wrapRef} className="absolute inset-0">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {view.w > 0 && <GlassesOverlay parts={visibleParts} view={view} drift={drift} selected={mode === "fix" ? null : selected} focus={stepParts} anomalies={mode === "fix" ? anomalies : []} onTap={onTap} />}
      </div>

      {/* top bar */}
      <div className="absolute top-0 inset-x-0 p-3 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent">
        <Link href="/" className="text-lg font-extrabold tracking-tight">ride<span className="text-[#FF6B1A]">along</span></Link>
        <span className="ml-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">LIVE SCAN</span>
        <span className="ml-auto text-xs text-white/80">{looking ? "Ray is looking…" : status}</span>
      </div>

      {/* small controls, top right under the status */}
      <div className="absolute right-3 top-12 flex gap-1.5 text-[11px]">
        <button onClick={() => setPaused((p) => !p)} className="rounded-full bg-black/50 px-2.5 py-1 font-semibold backdrop-blur">{paused ? "Resume" : "Freeze"}</button>
        <button onClick={() => setTracking((t) => !t)} className={`rounded-full px-2.5 py-1 font-semibold backdrop-blur ${tracking ? "bg-black/50" : "bg-black/30 text-white/50"}`}>Track</button>
        <Link href={`/call?task=${encodeURIComponent("I took this apart. Help me put it back together the right way, every screw and tube where it goes.")}&name=${encodeURIComponent("Put it back together")}`} className="rounded-full bg-hazard px-4 py-1.5 font-display text-sm uppercase tracking-wide text-ink">📞 Ask Ray</Link>
      </div>

      <ScanDrawer mode={mode} setMode={(m) => { setMode(m); if (m !== "tour" && m !== "fix") setSelected(null); if (m === "tour") setSelected(PARTS[tourIndex].label); }}
        seen={seen} inView={inView} selected={selected} onSelect={onTap}
        tourIndex={tourIndex} setTourIndex={setTourIndex}
        plan={plan} stepIndex={stepIndex} setStepIndex={setStepIndex} planning={planning} onPlan={onPlan}
        lastSay={lastSay} listening={listening} onMic={onMic} />

      {needTap && (
        <button onClick={async () => { if (!(await startCamera())) setErr("Camera blocked. In Safari: aA menu → Website Settings → Camera → Allow, then reload."); }}
          className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-2xl bg-[#FF6B1A] px-6 py-5 text-xl font-black text-black shadow-xl">
          Tap to start the camera
        </button>
      )}
      {err && <div className="absolute left-3 right-3 top-24 rounded-xl bg-red-600/90 p-3 text-sm">{err}</div>}
      {selected && (
        <div className="absolute left-3 right-24 bottom-20 rounded-xl bg-black/70 p-3 text-sm backdrop-blur">
          <b style={{ color: byLabel(selected)?.color }}>{selected}</b> · {byLabel(selected)?.says}
        </div>
      )}
    </main>
  );
}
