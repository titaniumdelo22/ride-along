/** The fixed parts list for the demo unit (Clover D1 water cooler). Stable names + stable colors = labels that don't flicker. */
export type PartDef = { label: string; color: string; hint: string; says: string };

export const PARTS: PartDef[] = [
  { label: "hot water tap", color: "#FF3B30", hint: "the red-marked faucet or push lever on the front", says: "That's the hot water tap. It's fed by the hot tank behind it, which keeps water near 90 degrees Celsius." },
  { label: "cold water tap", color: "#0A84FF", hint: "the blue-marked faucet or push lever on the front", says: "That's the cold water tap. The cold tank behind it is chilled by the compressor and the coils on the back." },
  { label: "drip tray", color: "#8E8E93", hint: "the removable grate and tray under the taps", says: "The drip tray catches spills. It lifts out for cleaning." },
  { label: "cabinet door", color: "#34C759", hint: "the lower front door or panel of the cabinet", says: "The cabinet door covers the storage compartment or the lower cabinet." },
  { label: "indicator lights", color: "#FF2D55", hint: "the small hot and cold status lamps on the front", says: "Those are the indicator lights. Red means the heater is on, green or blue means the compressor is cooling." },
  { label: "water bottle", color: "#30B0C7", hint: "the large bottle or reservoir on top", says: "That's the supply bottle. Water flows down from here into the hot and cold tanks." },
  { label: "condenser coils", color: "#FF9500", hint: "the black grid of tubes on the back", says: "Those are the condenser coils. They dump heat from the cold tank into the room. Dust on them is the number one reason a cooler stops getting cold." },
  { label: "compressor", color: "#AF52DE", hint: "the black dome-shaped pump at the bottom back", says: "That's the compressor. It pumps refrigerant through the coils. You should hear it hum when the cold light is on." },
  { label: "data plate", color: "#FFD60A", hint: "the model and serial number label", says: "That's the data plate. Model, serial, volts, amps, and refrigerant type. Always read it first." },
  { label: "wiring diagram", color: "#A2E63A", hint: "the printed wiring schematic sticker", says: "That's the wiring diagram. It shows the thermostats, the heater, and the compressor circuit, so you can trace a fault." },
  { label: "power cord", color: "#A2845E", hint: "the electrical cord and plug", says: "That's the power cord. Unplug it before you touch anything on the back." },
  { label: "drain plug", color: "#6B8E23", hint: "the small drain cap or valve on the back near the bottom", says: "That's the drain plug. You open it to empty the tanks before moving or sanitizing the unit." },
];

export const LABELS = PARTS.map((p) => p.label);
export const byLabel = (label: string) => PARTS.find((p) => p.label === label.trim().toLowerCase());
