# Ride Along

An AI journeyman on a live video call. Point a phone at the machine; every part lights up in color with its name (**Glasses** view), and a coach talks you through the job step by step while watching the camera (**Call** view).

## Run it (demo day)

```bash
npm install
npm run dev          # http://localhost:3000
cloudflared tunnel --url http://localhost:3000   # prints an https link for the phone
```

`.env.local` needs:

```
ANTHROPIC_API_KEY=...   # coach (Call view)
GEMINI_API_KEY=...      # part detection (Glasses view)
```

Open the https link on the phone → **Scan it** → allow the camera → point at the cooler. Tap any colored part to hear what it does. **Ask Ray** switches to the hands-free, step-by-step coach.

- `/glasses` — live overlay. Boxes from `gemini-3.1-flash-lite` (~1.2 s per frame, 480-px frames). Labels stay glued to the parts between detections with a tiny built-in camera-motion tracker (`lib/motion.ts`). With no camera (desktop) it runs on `public/demo/cooler.jpg`.
- `lib/parts.ts` — the fixed parts list, colors, and what the coach says when you tap each one. Edit this to match the machine.
- "Outlines" (pixel masks from Gemini) exists as a toggle but is **off**: on Oct 7 2026 the mask-capable models took 60–140 s per frame. Leave it off for the demo.

---

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
