/**
 * Tiny camera-motion tracker, no dependencies.
 * Each frame we downscale the video to a 96x54 gray thumbnail and block-match it against the previous
 * one to find how far the picture shifted (in fractions of the frame). The overlay uses the shift that
 * accumulated since a detection's frame was captured to keep labels glued to the parts while the
 * camera pans. Translation only: the cooler stands still, the phone moves. Good enough on stage.
 */
export class MotionTracker {
  readonly W = 96;
  readonly H = 54;
  private prev: Float32Array | null = null;
  private cur = new Float32Array(this.W * this.H);
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Accumulated shift since start, in fractions of frame width/height. */
  total = { x: 0, y: 0 };
  lost = false;
  /** Shift found on the latest frame (fractions of the frame). */
  lastStep = { x: 0, y: 0 };

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
  }

  /** Call once per animation frame. Returns the per-frame shift (fractions). */
  step(video: HTMLVideoElement): { dx: number; dy: number } {
    if (!video.videoWidth) return { dx: 0, dy: 0 };
    this.ctx.drawImage(video, 0, 0, this.W, this.H);
    const d = this.ctx.getImageData(0, 0, this.W, this.H).data;
    const cur = this.cur;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) cur[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
    let dx = 0, dy = 0;
    if (this.prev) {
      // Match against a KEYFRAME (the last frame where we accepted a shift), so slow pans that move
      // less than a thumbnail pixel per frame still add up instead of being thrown away.
      const R = 8;
      let best = Infinity, bx = 0, by = 0, zero = 0;
      for (let oy = -R; oy <= R; oy++) {
        for (let ox = -R; ox <= R; ox++) {
          let sad = 0, n = 0;
          for (let y = R; y < this.H - R; y += 2) {
            const py = y - oy;
            for (let x = R; x < this.W - R; x += 2) {
              sad += Math.abs(cur[y * this.W + x] - this.prev[py * this.W + (x - ox)]);
              n++;
            }
          }
          sad /= n;
          if (ox === 0 && oy === 0) zero = sad;
          if (sad < best) { best = sad; bx = ox; by = oy; }
        }
      }
      this.lost = best > 40;
      const moved = (bx !== 0 || by !== 0) && zero - best > 1.2 && best < 30;
      if (moved || this.lost) {
        if (moved) { dx = bx / this.W; dy = by / this.H; }
        this.prev.set(cur); // new keyframe
      }
    } else {
      this.prev = new Float32Array(this.W * this.H);
      this.prev.set(cur);
    }
    this.total.x += dx;
    this.total.y += dy;
    this.lastStep = { x: dx, y: dy };
    return { dx, dy };
  }
}
