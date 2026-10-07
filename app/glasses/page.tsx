"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import GlassesOverlay, { type OverlayPart } from "@/components/GlassesOverlay";
import { PARTS, byLabel } from "@/lib/parts";

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
  const useMasksRef = useRef(useMasks);
  const pausedRef = useRef(paused);
  useMasksRef.current = useMasks;
  pausedRef.current = paused;

  // camera
  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setStatus("Looking…");
      } catch (e) {
        console.error(e);
        // No camera (desktop browser, or blocked): run on a still demo photo so the whole pipeline still works.
        const still = new URLSearchParams(window.location.search).get("still") || "/demo/cooler.jpg";
        const im = new Image();
        im.onload = async () => {
          const c = document.createElement("canvas");
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          const ctx = c.getContext("2d")!;
          const paint = () => ctx.drawImage(im, 0, 0);
          paint();
          const iv = setInterval(paint, 500);
          stream = c.captureStream(2);
          const v = videoRef.current!;
          v.srcObject = stream;
          await v.play();
          setStatus("Demo photo (no camera)");
          v.addEventListener("emptied", () => clearInterval(iv), { once: true });
        };
        im.onerror = () => setErr("Camera blocked. Allow camera access and reload. On a phone this page must be opened over https.");
        im.src = still;
      }
    })();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

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

  const merge = useCallback((boxes: OverlayPart[]) => {
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
  }, []);

  // fast loop: boxes
  useEffect(() => {
    let stop = false;
    let lastBoxes: OverlayPart[] = [];
    const loop = async () => {
      while (!stop) {
        if (pausedRef.current) { await new Promise((r) => setTimeout(r, 200)); continue; }
        const frame = grab(480, 0.6);
        if (!frame) { await new Promise((r) => setTimeout(r, 200)); continue; }
        const t0 = Date.now();
        try {
          const res = await fetch("/api/parts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frame, mode: "boxes" }) });
          const j = (await res.json()) as { parts?: OverlayPart[]; error?: string };
          if (j.error) throw new Error(j.error);
          lastBoxes = j.parts ?? [];
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

  const onTap = (label: string | null) => {
    setSelected(label);
    if (!label) return;
    const def = byLabel(label);
    if (def) speak(def.says);
  };

  return (
    <main className="h-dvh w-screen bg-black text-white overflow-hidden relative select-none">
      <div ref={wrapRef} className="absolute inset-0">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        {view.w > 0 && <GlassesOverlay parts={parts} view={view} drift={{ dx: 0, dy: 0, s: 1 }} selected={selected} onTap={onTap} />}
      </div>

      {/* top bar */}
      <div className="absolute top-0 inset-x-0 p-3 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent">
        <Link href="/" className="text-lg font-extrabold tracking-tight">ride<span className="text-[#FF6B1A]">along</span></Link>
        <span className="ml-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">GLASSES</span>
        <span className="ml-auto text-xs text-white/80">{status}</span>
      </div>

      {/* legend */}
      <div className="absolute right-3 top-14 flex flex-col gap-1.5 max-h-[60vh] overflow-auto">
        {PARTS.filter((p) => seen.has(p.label)).map((p) => (
          <button key={p.label} onClick={() => onTap(selected === p.label ? null : p.label)}
            className={`flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur ${selected === p.label ? "bg-white text-black" : "bg-black/50"}`}>
            <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
            {p.label}
          </button>
        ))}
      </div>

      {/* bottom bar */}
      <div className="absolute bottom-0 inset-x-0 p-3 pb-6 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent text-xs">
        <button onClick={() => setPaused((p) => !p)} className="rounded-full bg-white/15 px-3 py-2 font-semibold backdrop-blur">{paused ? "Resume" : "Freeze"}</button>
        <button onClick={() => setUseMasks((m) => !m)} className={`rounded-full px-3 py-2 font-semibold backdrop-blur ${useMasks ? "bg-[#FF6B1A] text-black" : "bg-white/15"}`}>Outlines {useMasks ? "on" : "off"}</button>
        <Link href="/call" className="rounded-full bg-white/15 px-3 py-2 font-semibold backdrop-blur">Call my pro →</Link>
        <span className="ml-auto text-white/60 tabular-nums">boxes {ms.box ? `${(ms.box / 1000).toFixed(1)}s` : "–"} · outlines {ms.mask ? `${(ms.mask / 1000).toFixed(1)}s` : "–"}</span>
      </div>

      {err && <div className="absolute left-3 right-3 bottom-20 rounded-xl bg-red-600/90 p-3 text-sm">{err}</div>}
      {selected && (
        <div className="absolute left-3 right-24 bottom-20 rounded-xl bg-black/70 p-3 text-sm backdrop-blur">
          <b style={{ color: byLabel(selected)?.color }}>{selected}</b> · {byLabel(selected)?.says}
        </div>
      )}
    </main>
  );
}
