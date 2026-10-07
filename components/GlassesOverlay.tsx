"use client";
import { useEffect, useRef } from "react";

export type OverlayPart = { label: string; color: string; box: [number, number, number, number]; mask?: string | null };
export type OverlayAnomaly = { part: string; issue: string; box: [number, number, number, number] };

type Props = {
  parts: OverlayPart[];
  /** Size of the video element on screen and the intrinsic video size, so we map 0..1 coords through object-fit: cover. */
  view: { w: number; h: number; vw: number; vh: number };
  /** Shift to apply while waiting for the next detection, in fractions of the frame (camera moved since capture). */
  drift: { dx: number; dy: number };
  selected?: string | null;
  /** When set, only these labels are drawn bright; the rest are dimmed. */
  focus?: Set<string> | null;
  /** Problems the coach spotted in the current view, drawn in red. */
  anomalies?: OverlayAnomaly[];
  onTap?: (label: string | null) => void;
};

type Box = [number, number, number, number];

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Canvas painted over the video. Runs its own animation loop: every box GLIDES toward where it should be
 * (new detection + camera drift) instead of jumping, and labels fade in/out. That is what makes it feel smooth.
 */
export default function GlassesOverlay(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const p = useRef(props);
  p.current = props;
  // displayed state per label: smoothed box + opacity
  const shown = useRef<Map<string, { box: Box; alpha: number; color: string }>>(new Map());
  const smoothDrift = useRef({ dx: 0, dy: 0 });

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const c = ref.current;
      const { parts, view, drift, selected, focus, anomalies = [] } = p.current;
      if (!c || !view.vw || !view.vh) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(view.w * dpr) || c.height !== Math.round(view.h * dpr)) {
        c.width = Math.round(view.w * dpr);
        c.height = Math.round(view.h * dpr);
      }
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, view.w, view.h);

      // smooth the drift too (tracker moves in whole thumbnail pixels)
      const kd = 1 - Math.exp(-dt * 14);
      smoothDrift.current.dx += (drift.dx - smoothDrift.current.dx) * kd;
      smoothDrift.current.dy += (drift.dy - smoothDrift.current.dy) * kd;

      // object-fit: cover mapping
      const scale = Math.max(view.w / view.vw, view.h / view.vh);
      const dw = view.vw * scale, dh = view.vh * scale;
      const ox = (view.w - dw) / 2, oy = (view.h - dh) / 2;
      const map = (x: number, y: number) => [ox + (x + smoothDrift.current.dx) * dw, oy + (y + smoothDrift.current.dy) * dh] as const;

      // glide each displayed box toward its target; fade out boxes whose part is gone
      const kb = 1 - Math.exp(-dt * 6); // ~0.17 s time constant
      const ka = 1 - Math.exp(-dt * 8);
      const live = new Set<string>();
      for (const part of parts) {
        live.add(part.label);
        const cur = shown.current.get(part.label);
        if (!cur) shown.current.set(part.label, { box: [...part.box] as Box, alpha: 0, color: part.color });
        else for (let i = 0; i < 4; i++) cur.box[i] += (part.box[i] - cur.box[i]) * kb;
      }
      for (const [label, st] of shown.current) {
        const target = live.has(label) ? 1 : 0;
        st.alpha += (target - st.alpha) * ka;
        if (!live.has(label) && st.alpha < 0.02) shown.current.delete(label);
      }

      for (const [label, st] of shown.current) {
        const [x0, y0] = map(st.box[0], st.box[1]);
        const [x1, y1] = map(st.box[2], st.box[3]);
        const w = x1 - x0, h = y1 - y0;
        const dim = (selected && selected !== label) || (focus && focus.size > 0 && !focus.has(label));
        const a = st.alpha * (dim ? 0.35 : 1);
        ctx.fillStyle = hexA(st.color, 0.22 * a);
        ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 10); ctx.fill();
        ctx.strokeStyle = hexA(st.color, 0.95 * a);
        ctx.lineWidth = selected === label ? 4 : 2.5;
        ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 10); ctx.stroke();

        // label pill
        const text = label.replace(/^\w/, (ch) => ch.toUpperCase());
        ctx.font = "600 14px -apple-system, system-ui, sans-serif";
        const tw = ctx.measureText(text).width + 18;
        const lx = Math.max(4, Math.min(x0, view.w - tw - 4));
        const ly = y0 - 26 < 4 ? y0 + 6 : y0 - 26;
        ctx.globalAlpha = a;
        ctx.fillStyle = st.color;
        ctx.beginPath(); ctx.roundRect(lx, ly, tw, 22, 11); ctx.fill();
        ctx.fillStyle = "#000";
        ctx.fillText(text, lx + 9, ly + 15.5);
        ctx.globalAlpha = 1;
      }

      // anomalies: red pulsing frame + issue tag
      const pulse = 0.55 + 0.45 * Math.sin(now / 250);
      for (const an of anomalies) {
        const [x0, y0] = map(an.box[0], an.box[1]);
        const [x1, y1] = map(an.box[2], an.box[3]);
        ctx.strokeStyle = `rgba(255,59,48,${0.5 + 0.5 * pulse})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 8); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(255,59,48,${0.12 + 0.1 * pulse})`;
        ctx.beginPath(); ctx.roundRect(x0, y0, x1 - x0, y1 - y0, 8); ctx.fill();
        const text = `⚠ ${an.issue}`;
        ctx.font = "700 13px -apple-system, system-ui, sans-serif";
        const tw = Math.min(ctx.measureText(text).width + 18, view.w - 8);
        const lx = Math.max(4, Math.min(x0, view.w - tw - 4));
        const ly = y1 + 6 > view.h - 26 ? y0 - 26 : y1 + 6;
        ctx.fillStyle = "#FF3B30";
        ctx.beginPath(); ctx.roundRect(lx, ly, tw, 22, 11); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(text, lx + 9, ly + 15.5, tw - 18);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ width: props.view.w, height: props.view.h }}
      className="absolute inset-0"
      onClick={(e) => {
        const { parts, view, onTap } = p.current;
        if (!onTap) return;
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const scale = Math.max(view.w / view.vw, view.h / view.vh);
        const dw = view.vw * scale, dh = view.vh * scale;
        const x = (px - (view.w - dw) / 2) / dw - smoothDrift.current.dx, y = (py - (view.h - dh) / 2) / dh - smoothDrift.current.dy;
        let best: OverlayPart | null = null;
        for (const part of parts) {
          const [x0, y0, x1, y1] = part.box;
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
            if (!best || (x1 - x0) * (y1 - y0) < (best.box[2] - best.box[0]) * (best.box[3] - best.box[1])) best = part;
          }
        }
        onTap(best?.label ?? null);
      }}
    />
  );
}
