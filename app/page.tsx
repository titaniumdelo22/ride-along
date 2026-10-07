import Link from "next/link";
import RayFace from "./call/RayFace";

const JOBS = [
  { name: "Put it back together", task: "I took this apart. Help me put it back together the right way, every screw and tube where it goes.", xp: 500 },
  { name: "Mount a TV", task: "I want to mount my TV on the wall. Teach me to do it right.", xp: 300 },
  { name: "Fix a leaky faucet", task: "My kitchen faucet drips. Teach me to fix it.", xp: 350 },
  { name: "Cooler won't cool", task: "This water cooler has an out of order sign. I know nothing about it. Help me fix it.", xp: 400 },
  { name: "Dead outlet", task: "An outlet stopped working. Teach me to check and reset the GFCI safely.", xp: 200 },
  { name: "Hang a shelf", task: "I want to hang a shelf on the wall so it's level and holds weight.", xp: 150 },
];

export default function Home() {
  return (
    <main className="min-h-dvh bg-ink text-bone">
      <div className="hazard h-2" />
      <div className="mx-auto max-w-xl px-6 pb-14">
        <header className="flex items-center justify-between pt-5">
          <span className="font-display text-2xl uppercase tracking-wide">
            Ride<span className="text-hazard">Along</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-bone/50">No experience required</span>
        </header>

        <section className="mt-9 flex items-end gap-4">
          <div className="w-32 flex-none -rotate-3">
            <div className="h-40 overflow-hidden rounded-lg border-2 border-bone">
              <RayFace talking={false} mood="happy" look={0.5} />
            </div>
            <div className="mt-2 font-mono text-[9px] uppercase leading-snug tracking-wider text-bone/55">
              Ray · Journeyman
              <br />
              On call 24/7
            </div>
          </div>
          <p className="mb-9 rounded-2xl rounded-bl-none bg-bone px-4 py-3 text-[15px] font-semibold leading-snug text-ink">
            Hey, I&apos;m Ray. Point your phone at it. I&apos;ll walk you through it.
          </p>
        </section>

        <h1 className="mt-8 font-display text-[3.7rem] uppercase leading-[0.9]">
          Make DIY fun. Turn anyone into a <span className="text-hazard">tradesman.</span>
        </h1>

        <Link href="/glasses" className="mt-9 flex h-16 items-center justify-between bg-hazard px-6 font-display text-2xl uppercase tracking-wide text-ink active:translate-y-0.5">
          Scan it <span>→</span>
        </Link>
        <Link href="/call" className="mt-3 flex h-14 items-center justify-between border-2 border-bone px-6 font-display text-xl uppercase tracking-wide active:translate-y-0.5">
          Ask Ray <span>→</span>
        </Link>

        <h2 className="mt-14 font-mono text-[11px] uppercase tracking-[0.25em] text-bone/50">Pick a job</h2>
        <ul className="mt-3 divide-y divide-bone/15 border-y border-bone/15">
          {JOBS.map((j) => (
            <li key={j.name}>
              <Link href={`/call?task=${encodeURIComponent(j.task)}&name=${encodeURIComponent(j.name)}`} className="flex items-baseline justify-between py-4 active:opacity-60">
                <span className="font-display text-[1.9rem] uppercase leading-none tracking-wide">{j.name}</span>
                <span className="font-display text-2xl text-hazard">→</span>
              </Link>
            </li>
          ))}
        </ul>

        <p className="mt-14 text-lg leading-snug text-bone/80">
          Every job Ray checks on camera counts toward a certificate. <span className="text-bone">Learn at home. Get hired.</span>
        </p>
        <div className="mt-6 grid grid-cols-3 gap-3 font-mono text-[11px] uppercase tracking-wider text-bone/55">
          <div>
            <span className="block font-display text-5xl leading-none text-bone">01</span>Scan it
          </div>
          <div>
            <span className="block font-display text-5xl leading-none text-bone">02</span>Ask Ray
          </div>
          <div>
            <span className="block font-display text-5xl leading-none text-hazard">03</span>Get certified
          </div>
        </div>
      </div>
      <div className="hazard h-2" />
    </main>
  );
}
