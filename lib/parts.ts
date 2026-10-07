/**
 * The fixed parts list for the demo unit: Clover D1 countertop hot-and-cold water cooler, serial 14123673,
 * photographed 2026-10-07 with the back cover off. Stable names + stable colors = labels that don't flicker.
 */
export type PartDef = { label: string; color: string; hint: string; says: string };

export const PARTS: PartDef[] = [
  // front
  { label: "hot water tap", color: "#FF3B30", hint: "the red PUSH button on the front, left side, with the child-safety lock", says: "That's the hot water tap, the red push button. It's fed by the hot tank in the back, which keeps water near boiling. The red button has a safety lock so kids can't scald themselves." },
  { label: "cold water tap", color: "#0A84FF", hint: "the dark push paddle on the front, right of the red button", says: "That's the cold water tap. Water comes from the cold tank up top, which the compressor chills." },
  { label: "indicator lights", color: "#FF2D55", hint: "the small HOT and COLD lamps on the upper right of the front panel", says: "Those are the indicator lights. The red HOT lamp means the heater is on. The green COLD lamp means the compressor is cooling. If COLD never lights, the cooling circuit isn't getting power." },
  { label: "drip tray", color: "#8E8E93", hint: "the slotted black grate at the bottom front under the taps", says: "The drip tray catches spills. It lifts straight out for cleaning." },
  // top
  { label: "cold tank", color: "#30B0C7", hint: "the round white tank with the gray foam lid on top of the machine", says: "That's the cold tank. Water sits in here and the refrigerant coil wrapped around it chills it. The gray foam is insulation." },
  { label: "water inlet tube", color: "#5AC8FA", hint: "the clear plastic tube running into the top of the cold tank", says: "That's the water inlet tube. It carries water from the bottle or the top reservoir down into the cold tank." },
  // back and side
  { label: "condenser coils", color: "#FF9500", hint: "the tall grid of black tubes and thin wires on the back of the machine", says: "Those are the condenser coils. They dump heat from the refrigerant into the room. Dust on them is the number one reason a cooler stops getting cold." },
  { label: "compressor", color: "#AF52DE", hint: "the black dome-shaped pump at the bottom, seen through the side opening", says: "That's the compressor. It pumps refrigerant through the coils. When the COLD light is on you should hear it hum." },
  { label: "compressor relay", color: "#BF5AF2", hint: "the black plastic box with wires plugged in, bolted to the side of the compressor", says: "That's the compressor relay and overload. It starts the compressor and cuts power if it overheats. The wires from the harness plug in here." },
  { label: "filter dryer", color: "#D4A373", hint: "the short copper cylinder on the thin copper line near the compressor", says: "That's the filter dryer. It traps moisture and debris in the refrigerant before the capillary tube." },
  { label: "capillary tube", color: "#C77D4E", hint: "the thin copper tube coiled in loops, zip-tied, near the hot tank", says: "That's the capillary tube. It's the tiny copper line that meters refrigerant into the cold tank coil." },
  { label: "hot tank", color: "#B00020", hint: "the black foam-wrapped cylinder inside the back, next to the compressor", says: "That's the hot tank, wrapped in black foam. The heater inside keeps water near 90 degrees Celsius. It's live at 120 volts when plugged in." },
  { label: "terminal block", color: "#FFD60A", hint: "the small gray block with three screws on the floor of the back, where the green ground wire and white wires attach", says: "That's the terminal block. Wires are held under its screws. The green one is ground. If a wire backs out of its screw, that circuit is dead." },
  { label: "wiring harness", color: "#A2E63A", hint: "the bundle of red, yellow, white and brown wires with spade connectors running across the back", says: "That's the wiring harness. It carries power to the heater, the compressor relay and the lights. Every connector should be fully pushed on." },
  { label: "hot water switch", color: "#FF6B1A", hint: "the red rocker switch on the back panel near the data plate", says: "That's the hot water switch. It turns the heater on and off. Off saves power when nobody needs hot water." },
  { label: "data plate", color: "#FFEE58", hint: "the white model and serial label on the back, low down", says: "That's the data plate. Model D1, serial 14123673, 120 volts, R134a refrigerant. Always read it first." },
  { label: "power cord", color: "#A2845E", hint: "the electrical cord and plug coming out of the back", says: "That's the power cord. Unplug it before you touch anything inside the back." },
];

export const LABELS = PARTS.map((p) => p.label);
export const byLabel = (label: string) => PARTS.find((p) => p.label === label.trim().toLowerCase());
