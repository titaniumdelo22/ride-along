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

4. "I need visual and audio feedback so the tradesman doesn't have to read a lot, maybe highlight parts." Claude made everything important spoken, added a pulsing ring and label on the part, camera-aim arrows, and color flashes with sounds for good, mistake and danger.
5. "Make it more visual and aesthetic and extremely fun to use. It should make DIY almost addicting, like a game." Claude added missions, XP, levels (Apprentice to Master), combos, badges, confetti, a level-up screen, and a 3-star job card.
6. "It also needs to tell us the tools we need, and a ranking before people start (newbie, intermediate, advanced) so the AI can move at the speed of the user's education level." Claude added the level picker, a Loadout screen of tool cards to check off, and level-specific instructions for both the plan and the live coaching.
7. "We need a go back to the last step, and a summary at the end so they can summarize what they did to others and use it to train." Claude added a back button and tap-any-step on the mission map, and an AI job report (what I did, what I learned, how to teach it, next time) that can be shared or read aloud and is saved to a logbook.
8. "A lot of people don't even know what they're looking at. Something that can help them identify it. For HVAC I wouldn't know the first place to start, or if my car engine blew." Claude added "What am I looking at?": it freezes the frame, labels the parts on it, says what it is, flags licensed-pro jobs, and gives where to start with a one-tap mission.
9. "It also has to identify what tools we need. Don't make the responses too wordy, this should be easy enough for high school dropouts." Claude added a "You'll need" tools row to identify and capped every AI answer at one short sentence in everyday words.
11. "This is hands-on, so the user needs to be able to speak to the agent and get a response like talking on the phone... if their hands were dirty or full they wouldn't want to touch their phones." Claude added hands-free mode: the mic reopens every time Ray stops talking (and stays closed while he talks so he doesn't hear himself), questions go straight to Ray with the live camera, and short phrases run the app ("next", "go back", "repeat", "fix it", "let's go"). Ray never talks over the learner, and a question asked mid-look is queued, not dropped.
12. "There's a lot going on on the screen. Minimize it, make it less confusing. They don't have to fill out everything on one page, it can be a multi-page prompt." Claude split the start into one question per page (your level, asked once and remembered; point at it; or pick the job), with big type and hairlines instead of boxes, and cut the job screen to 3 buttons since the mic is always on.
13. "It should be trained for unexpected things to pop up." Claude taught the coach to watch for curveballs (a leak, burn marks, a stuck screw, a broken or missing part, a setup that doesn't match the plan): it says so calmly, puts safety first, inserts the steps to handle it right where you are, shows a Curveball banner, and the job report records what came up. Tested live: "there's water on the floor" got "unplug it first" plus 3 new steps in 8 seconds.
14. "The app should be able to start where the user is in the process, like me right now" (he was stuck disconnecting the cooler's water line). Claude made the plan include where to start: Ray writes the whole job but picks up at the step you're stuck on, counts the earlier steps as done, and says where he's picking up. Tested live with Titanium's photo of the tank: Ray started at step 6, "Free the white line."
10. Speed: Claude split planning into a fast gear-list call (about 5 seconds) and a steps call that runs while the learner gears up, and writes the steps ahead while they read the identify screen, so "Fix it with Ray" opens in under a second.

Tagline (Titanium): "Making DIY fun. Basically turning everyone into a tradesman."

## How it works
- `lib/identify.ts`: "What am I looking at?" One camera frame in; the item, its parts pinned on the image (x, y), the tools to grab, the first 3 checks, a licensed-pro warning when it applies, and 1 or 2 safe missions out.
- `lib/guide.ts`: the coach, all with structured JSON output.
  - kit(): the item and the gear list, fast, so the Loadout screen shows in seconds.
  - summarize(): the end-of-job report from what actually happened (mistakes caught, questions asked, steps redone).
  - plan(): reads the task and the camera frame (model and serial from the data plate), returns the steps, each with what the coach must SEE to call it done, the why, a safety note, and the skill it trains.
  - watch(): every 2.5 seconds (and whenever the learner asks a question), the newest camera frame plus the current step: is it done, should the coach say something, where to point (x, y on the image), any safety issue, any mistake.
- `app/call/page.tsx`: the call screen. Live camera, the pro in a FaceTime-style bubble, spoken guidance with captions, a pulsing ring on the part being discussed, the step and progress, push-to-talk questions, a safety banner, and the end-of-job skills log.
- Practice mode: with no API key the same screens run a scripted walkthrough of the Clover D1 job, so the demo never depends on the venue Wi-Fi.
