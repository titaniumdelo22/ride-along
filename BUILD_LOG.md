# Ride Along: build log

Musa Labs Hackathon, SF Tech Week, Oct 7 2026. Team: Titanium Delo. Built 12:30 to 4:00 PM.
Every line of code was written by AI (Claude Code, Claude Opus 5.5). Titanium directed; the model wrote.

## Tools
- Claude Code (Claude Opus 5.5) on a MacBook: wrote all code, ran the dev server, tested in a built-in browser.
- Claude API (claude-opus-5-5) inside the app: plans the job from the camera and the label, then watches the live camera.
- Next.js 16, React 19, Tailwind, @anthropic-ai/sdk, zod. Browser camera (getUserMedia), browser voice in and out (Web Speech).
- cloudflared: a secure https link so a phone's camera can use the laptop's server.

## The prompts that built it (Titanium's words, in order)
1. "A visual / audio teacher like FaceTiming a pro. We're shown a problem for our use case (a water dispenser) and the AI agent looks at it live with us and visually and audibly walks us through it. For new mechanics, HVAC technicians, plumbers. Scan the serial number. We need a demo in 3 hours."
2. Claude proposed: the coach points at parts on screen, checks each step on camera before moving on, Teach mode (asks what comes next before telling), a safety watch, label reading, a skills log with TradesQuest XP. Titanium: build it.
3. "This is the machine I'm using for the demo, it's a water machine" (photos of a Clover D1 water cooler: label, wiring diagram, dusty condenser coils). Claude rewrote the practice script around the real unit: a no-cool check and condenser coil cleaning.

## How it works
- `lib/guide.ts`: two Claude calls with structured JSON output.
  - plan(): reads the task and the camera frame (model and serial from the data plate), returns the steps, each with what the coach must SEE to call it done, the why, a safety note, and the skill it trains.
  - watch(): every 2.5 seconds (and whenever the learner asks a question), the newest camera frame plus the current step: is it done, should the coach say something, where to point (x, y on the image), any safety issue, any mistake.
- `app/call/page.tsx`: the call screen. Live camera, the pro in a FaceTime-style bubble, spoken guidance with captions, a pulsing ring on the part being discussed, the step and progress, push-to-talk questions, a safety banner, and the end-of-job skills log.
- Practice mode: with no API key the same screens run a scripted walkthrough of the Clover D1 job, so the demo never depends on the venue Wi-Fi.
