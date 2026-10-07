import fs from "node:fs";
import path from "node:path";

/**
 * Reference photos of THIS unit (Clover D1) taken 2026-10-07 with the back cover OFF and the power cord UNPLUGGED.
 * Wiring and parts are untouched: this is the correct layout, but the unit is not running, so lights are off in them.
 * They are handed to the models as "this is how the inside is supposed to look" so a live view can be compared
 * against them: a wire off a screw, a connector hanging, a part moved. They do not say what is broken.
 */
export const REFERENCE: { file: string; what: string }[] = [
  { file: "ref_3205.jpg", what: "terminal block close-up: gray block with three screws; green ground wire under the LEFT screw; white wires with connectors beside it; red and yellow harness wires passing above" },
  { file: "ref_3204.jpg", what: "compressor top with its black relay box on the left; yellow and red wires on the relay's screw terminals (silver bracket, right); white, brown, yellow, red harness zip-tied across; copper filter dryer and lines" },
  { file: "ref_3203.jpg", what: "side opening overview: compressor dome left, black foam hot tank right, harness across the floor, terminal block bottom center" },
  { file: "ref_3206.jpg", what: "side opening, other angle: white foam-wrapped line, coiled copper capillary tube zip-tied, filter dryer, compressor" },
  { file: "ref_3209.jpg", what: "back: condenser coil grid, red hot water switch on the right, data plate at the bottom, power cord" },
  { file: "ref_3200.jpg", what: "top: round cold tank with gray foam lid, clear water inlet tube, white float cap" },
  { file: "ref_3210.jpg", what: "front: red PUSH hot tap, dark cold paddle, HOT and COLD indicator lights, drip tray" },
];

const cache = new Map<string, string>();
export function referenceImage(file: string): string | null {
  if (cache.has(file)) return cache.get(file)!;
  try {
    const b64 = fs.readFileSync(path.join(process.cwd(), "public", "reference", file)).toString("base64");
    cache.set(file, b64);
    return b64;
  } catch {
    return null;
  }
}

/** Pick reference photos: all for planning; the inside close-ups only for quick looks. */
export function referenceSet(kind: "all" | "inside"): { b64: string; what: string }[] {
  const files = kind === "all" ? REFERENCE : REFERENCE.slice(0, 3);
  return files.map((r) => ({ b64: referenceImage(r.file), what: r.what })).filter((r): r is { b64: string; what: string } => !!r.b64);
}
