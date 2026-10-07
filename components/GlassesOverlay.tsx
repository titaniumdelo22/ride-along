"use client";
import { useEffect, useRef } from "react";

export type OverlayPart = { label: string; color: string; box: [number, number, number, number]; mask?: string | null };

type Props = {
  parts: OverlayPart[];
  /** Size of the video element on screen and the intrinsic video size, so we map 0..1 coords through object-fit: cover. */
  view: { w: number; h: number; vw: number; vh: number };
  /** Extra transform applied while waiting for the next detection (dx, dy in px, scale around center). */
  drift: { dx: number; dy: number; s: number };
  selected?: string | null;
  onTap?: (label: string | null) => void;
};

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Canvas painted over the video: colored masks (or boxes) + label pills. */
export default function GlassesOverlay({ parts, view, drift, selected, onTap }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const imgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const tinted = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Decode masks once per mask string.
  useEffect(() => {
    for (const p of parts) {
      if (!p.mask || imgs.current.has(p.mask)) continue;
      const im = new Image();
      im.src = p.mask;
      imgs.current.set(p.mask, im);
    }
  }, [parts]);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = view.w * dpr;
    c.height = view.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    if (!view.vw || !view.vh) return;

    // object-fit: cover mapping
    const scale = Math.max(view.w / view.vw, view.h / view.vh);
    const dw = view.vw * scale, dh = view.vh * scale;
    const ox = (view.w - dw) / 2, oy = (view.h - dh) / 2;
    const map = (x: number, y: number) => {
      let px = ox + x * dw, py = oy + y * dh;
      const cx = view.w / 2, cy = view.h / 2;
      px = cx + (px - cx) * drift.s + drift.dx;
      py = cy + (py - cy) * drift.s + drift.dy;
      return [px, py] as const;
    };

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, view.w, view.h);
      let pending = false;
      for (const p of parts) {
        const [x0, y0] = map(p.box[0], p.box[1]);
        const [x1, y1] = map(p.box[2], p.box[3]);
        const w = x1 - x0, h = y1 - y0;
        const dim = selected && selected !== p.label;
        const alpha = dim ? 0.12 : 0.42;
        const im = p.mask ? imgs.current.get(p.mask) : null;
        if (im && im.complete && im.naturalWidth > 0) {
          let t = tinted.current.get(p.mask + p.color);
          if (!t) {
            t = document.createElement("canvas");
            t.width = im.naturalWidth; t.height = im.naturalHeight;
            const tc = t.getContext("2d")!;
            tc.drawImage(im, 0, 0);
            const id = tc.getImageData(0, 0, t.width, t.height);
            const d = id.data;
            const n = parseInt(p.color.slice(1), 16);
            const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
            for (let i = 0; i < d.length; i += 4) {
              const on = d[i] > 127;
              d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = on ? 255 : 0;
            }
            tc.putImageData(id, 0, 0);
            tinted.current.set(p.mask + p.color, t);
          }
          ctx.globalAlpha = alpha;
          ctx.drawImage(t, x0, y0, w, h);
          ctx.globalAlpha = 1;
        } else {
          if (im && !im.complete) pending = true;
          ctx.fillStyle = hexA(p.color, alpha);
          ctx.beginPath();
          ctx.roundRect(x0, y0, w, h, 10);
          ctx.fill();
        }
        ctx.strokeStyle = hexA(p.color, dim ? 0.4 : 0.95);
        ctx.lineWidth = selected === p.label ? 4 : 2;
        ctx.beginPath();
        ctx.roundRect(x0, y0, w, h, 10);
        ctx.stroke();

        // label pill
        const text = p.label.replace(/^\w/, (ch) => ch.toUpperCase());
        ctx.font = "600 14px -apple-system, system-ui, sans-serif";
        const tw = ctx.measureText(text).width + 18;
        const lx = Math.max(4, Math.min(x0, view.w - tw - 4));
        const ly = y0 - 26 < 4 ? y0 + 6 : y0 - 26;
        ctx.fillStyle = dim ? hexA(p.color, 0.5) : p.color;
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw, 22, 11);
        ctx.fill();
        ctx.fillStyle = "#000";
        ctx.fillText(text, lx + 9, ly + 15.5);
      }
      if (pending) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [parts, view, drift, selected]);

  return (
    <canvas
      ref={ref}
      style={{ width: view.w, height: view.h }}
      className="absolute inset-0"
      onClick={(e) => {
        if (!onTap) return;
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const scale = Math.max(view.w / view.vw, view.h / view.vh);
        const dw = view.vw * scale, dh = view.vh * scale;
        const x = (px - (view.w - dw) / 2) / dw, y = (py - (view.h - dh) / 2) / dh;
        // smallest box containing the tap wins
        let best: OverlayPart | null = null;
        for (const p of parts) {
          const [x0, y0, x1, y1] = p.box;
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
            if (!best || (x1 - x0) * (y1 - y0) < (best.box[2] - best.box[0]) * (best.box[3] - best.box[1])) best = p;
          }
        }
        onTap(best?.label ?? null);
      }}
    />
  );
}
