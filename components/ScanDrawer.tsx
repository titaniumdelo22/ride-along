"use client";
import { useEffect, useRef, useState } from "react";
import { PARTS, byLabel } from "@/lib/parts";
import type { FixPlan } from "@/lib/fix";

export type Mode = "parts" | "tour" | "fix";

type Props = {
  mode: Mode;
  setMode: (m: Mode) => void;
  seen: Set<string>;
  inView: Set<string>;
  selected: string | null;
  onSelect: (label: string | null) => void;
  // tour
  tourIndex: number;
  setTourIndex: (i: number) => void;
  // fix
  plan: FixPlan | null;
  stepIndex: number;
  setStepIndex: (i: number) => void;
  planning: boolean;
  onPlan: (problem: string) => void;
  lastSay: string | null;
  listening: boolean;
  onMic: () => void;
};

/** Bottom sheet on the Scan page: Parts (scroll + pick), Tour (one part at a time), Fix (say what's wrong → steps). */
export default function ScanDrawer(p: Props) {
  const [problem, setProblem] = useState("");
  const tourPart = PARTS[p.tourIndex];
  const step = p.plan?.steps[p.stepIndex];
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (p.mode === "fix" && !p.plan) inputRef.current?.focus(); }, [p.mode, p.plan]);

  return (
    <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-[#121212]/95 backdrop-blur text-white shadow-[0_-10px_40px_rgba(0,0,0,.6)]">
      {/* tabs */}
      <div className="flex gap-1 p-2 pt-3">
        {(["parts", "tour", "fix"] as Mode[]).map((m) => (
          <button key={m} onClick={() => p.setMode(m)}
            className={`flex-1 rounded-full py-2 text-sm font-bold capitalize ${p.mode === m ? "bg-[#FF6B1A] text-black" : "bg-white/10"}`}>
            {m === "parts" ? "Parts" : m === "tour" ? "Tour" : "Fix it"}
          </button>
        ))}
      </div>

      {p.mode === "parts" && (
        <div className="px-3 pb-6">
          <div className="text-xs text-white/60 mb-2">{p.inView.size} in view · tap one to label just that part</div>
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-3 px-3">
            <button onClick={() => p.onSelect(null)} className={`shrink-0 rounded-full px-3 py-2 text-sm font-semibold ${!p.selected ? "bg-white text-black" : "bg-white/10"}`}>All</button>
            {PARTS.map((d) => (
              <button key={d.label} onClick={() => p.onSelect(p.selected === d.label ? null : d.label)}
                className={`shrink-0 flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold ${p.selected === d.label ? "bg-white text-black" : p.inView.has(d.label) ? "bg-white/15" : "bg-white/5 text-white/40"}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />{d.label}
              </button>
            ))}
          </div>
          {p.selected && <p className="mt-2 text-sm text-white/85">{byLabel(p.selected)?.says}</p>}
        </div>
      )}

      {p.mode === "tour" && (
        <div className="px-3 pb-6">
          <div className="text-xs text-white/60">Stop {p.tourIndex + 1} of {PARTS.length}</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-bold"><span className="h-3 w-3 rounded-full" style={{ background: tourPart.color }} />{tourPart.label}</div>
          <p className="mt-1 text-sm text-white/85">{tourPart.says}</p>
          <p className="mt-1 text-xs text-white/50">{p.inView.has(tourPart.label) ? "In view ✓" : `Not in view yet. Show me ${tourPart.hint}.`}</p>
          <div className="mt-3 flex gap-2">
            <button disabled={p.tourIndex === 0} onClick={() => p.setTourIndex(p.tourIndex - 1)} className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold disabled:opacity-30">Back</button>
            <button onClick={() => p.setTourIndex(Math.min(PARTS.length - 1, p.tourIndex + 1))} className="flex-1 rounded-full bg-[#FF6B1A] px-4 py-2 text-sm font-bold text-black">{p.tourIndex === PARTS.length - 1 ? "Done" : "Next"}</button>
          </div>
        </div>
      )}

      {p.mode === "fix" && !p.plan && (
        <form className="px-3 pb-6" onSubmit={(e) => { e.preventDefault(); if (problem.trim()) p.onPlan(problem.trim()); }}>
          <div className="text-sm font-bold">What's going on?</div>
          <div className="mt-2 flex gap-2">
            <input ref={inputRef} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="e.g. the cold tap is loose and drips"
              className="flex-1 rounded-full bg-white/10 px-4 py-3 text-sm outline-none placeholder:text-white/40" />
            <button type="button" onClick={p.onMic} className={`rounded-full px-4 text-lg ${p.listening ? "bg-red-500" : "bg-white/10"}`}>🎙️</button>
          </div>
          <button type="submit" disabled={p.planning || !problem.trim()} className="mt-2 w-full rounded-full bg-[#FF6B1A] py-3 text-sm font-bold text-black disabled:opacity-40">
            {p.planning ? "Ray is looking…" : "Make a plan"}
          </button>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["Cold tap is loose and drips", "No cold water", "Not getting cold", "Leaking from the back"].map((q) => (
              <button type="button" key={q} onClick={() => setProblem(q)} className="rounded-full bg-white/10 px-3 py-1 text-xs">{q}</button>
            ))}
          </div>
        </form>
      )}

      {p.mode === "fix" && p.plan && step && (
        <div className="px-3 pb-6">
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>Step {p.stepIndex + 1} of {p.plan.steps.length}</span>
            <button onClick={() => p.onPlan("")} className="underline">New problem</button>
          </div>
          <div className="mt-1 h-1 w-full rounded bg-white/10"><div className="h-1 rounded bg-[#FF6B1A]" style={{ width: `${((p.stepIndex + 1) / p.plan.steps.length) * 100}%` }} /></div>
          <div className="mt-2 text-lg font-bold">{step.title}</div>
          <p className="text-sm text-white/85">{step.instruction}</p>
          {step.safety && <p className="mt-1 rounded-lg bg-red-600/30 px-2 py-1 text-xs text-red-200">⚠ {step.safety}</p>}
          {step.parts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {step.parts.map((l) => <span key={l} className="flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: byLabel(l)?.color }} />{l}{p.inView.has(l) ? " ✓" : ""}</span>)}
            </div>
          )}
          {p.lastSay && <p className="mt-2 text-xs text-[#FFB27A]">Ray: {p.lastSay}</p>}
          <div className="mt-3 flex gap-2">
            <button disabled={p.stepIndex === 0} onClick={() => p.setStepIndex(p.stepIndex - 1)} className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold disabled:opacity-30">Back</button>
            <button onClick={p.onMic} className={`rounded-full px-4 py-2 text-lg ${p.listening ? "bg-red-500" : "bg-white/10"}`}>🎙️</button>
            <button onClick={() => p.setStepIndex(Math.min(p.plan!.steps.length - 1, p.stepIndex + 1))} className="flex-1 rounded-full bg-[#FF6B1A] px-4 py-2 text-sm font-bold text-black">
              {p.stepIndex === p.plan.steps.length - 1 ? "Done ✓" : "Done, next"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
