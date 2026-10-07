import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh bg-[#0E0E0E] text-white">
      <div className="relative h-[52vh] min-h-[340px] bg-[url(https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=1200&q=70)] bg-cover bg-center">
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-[#0E0E0E]" />
        <div className="absolute left-6 top-6 text-2xl font-extrabold tracking-tight">
          ride<span className="text-[#FF6B1A]">along</span>
        </div>
      </div>
      <div className="mx-auto max-w-xl px-6 pb-12 -mt-24 relative">
        <h1 className="text-5xl font-extrabold leading-[1.02] tracking-tight">A journeyman on call, for every job.</h1>
        <p className="mt-4 text-lg text-white/75">
          Point your phone at the job. Your AI pro sees what you see, talks you through it step by step, points at the part, and stops you before you get hurt.
        </p>
        <Link href="/call" className="mt-8 flex h-16 items-center justify-center rounded-full bg-[#FF6B1A] text-xl font-bold">
          Call my pro
        </Link>
        <Link href="/glasses" className="mt-3 flex h-14 items-center justify-center rounded-full border border-white/25 text-lg font-bold">
          Put on the glasses
        </Link>
        <ul className="mt-10 space-y-4 text-white/85">
          <li><b className="text-white">Sees your work.</b> It checks each step on camera before moving on.</li>
          <li><b className="text-white">Teaches, not just tells.</b> Teach mode asks what comes next and why.</li>
          <li><b className="text-white">Reads the label.</b> Model and serial number, so the steps fit your exact unit.</li>
          <li><b className="text-white">Logs your skills.</b> Every job earns verified TradesQuest XP.</li>
        </ul>
        <p className="mt-10 text-sm text-white/50">For apprentices, new technicians, and anyone learning a trade with their hands.</p>
      </div>
    </main>
  );
}
