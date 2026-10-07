"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { REBUILD_TASK } from "@/lib/condition";

type Cond = { apart: boolean; state: string | null; missing: string[] };

/**
 * On the scan page: every few seconds, is the machine put back together?
 * If not, a hazard banner says what's off and opens Ray's rebuild.
 */
export default function ConditionBanner() {
  const [cond, setCond] = useState<Cond | null>(null);
  const [hidden, setHidden] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let stop = false;
    let busy = false;
    const look = async () => {
      if (stop || busy || document.hidden) return;
      const v = document.querySelector("video");
      if (!v || !v.videoWidth) return;
      busy = true;
      setChecking(true);
      try {
        const c = document.createElement("canvas");
        c.width = Math.min(640, v.videoWidth);
        c.height = Math.round((v.videoHeight / v.videoWidth) * c.width);
        c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
        const frame = c.toDataURL("image/jpeg", 0.55).split(",")[1];
        const r = await fetch("/api/condition", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frame }) });
        const d = (await r.json()) as Cond & { error?: string };
        if (!d.error && !stop) setCond(d);
      } catch {
        // Try again on the next look.
      } finally {
        busy = false;
        setChecking(false);
      }
    };
    const first = setTimeout(look, 1500);
    const id = setInterval(look, 8000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  // Always visible: it's actively scanning (a running bar under the top bar, a line sweeping the camera).
  const scanning = (
    <>
      <style>{`@keyframes rideIndet{0%{left:-35%}100%{left:100%}}@keyframes rideSweep{0%{top:12%}50%{top:82%}100%{top:12%}}`}</style>
      <div className="pointer-events-none absolute inset-x-6 z-10 h-0.5 bg-hazard/80 shadow-[0_0_24px_6px_rgba(255,95,0,.45)]" style={{ animation: "rideSweep 3s ease-in-out infinite" }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-1 overflow-hidden bg-bone/15">
        <div className="absolute inset-y-0 w-[35%] bg-hazard" style={{ animation: "rideIndet 1.1s linear infinite" }} />
      </div>
      <div className="pointer-events-none absolute left-3 top-[3.2rem] z-20 flex items-center gap-1.5 bg-ink/70 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-bone">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-hazard" />
        {checking ? "Checking build…" : "Scanning"}
      </div>
    </>
  );

  if (!cond?.apart || hidden) return scanning;
  return (
    <>
    {scanning}
    <div className="absolute inset-x-3 top-[5.5rem] z-20 animate-[rise_.4s_ease-out] bg-hazard p-3 text-ink shadow-2xl">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em]">⚠ Not put back together</div>
          <div className="mt-0.5 font-display text-2xl uppercase leading-none">{cond.state ?? "Something's still open"}</div>
          {cond.missing.length > 0 && <div className="mt-1 text-sm font-semibold">Still to go back: {cond.missing.join(", ")}</div>}
        </div>
        <button onClick={() => setHidden(true)} className="px-1 text-xl font-black" aria-label="Hide">
          ✕
        </button>
      </div>
      <Link
        href={`/call?task=${encodeURIComponent(REBUILD_TASK)}&name=${encodeURIComponent("Put it back together")}`}
        className="mt-2 flex items-center justify-between bg-ink px-4 py-2.5 font-display text-lg uppercase tracking-wide text-bone"
      >
        Put it back together with Ray <span>→</span>
      </Link>
    </div>
    </>
  );
}
