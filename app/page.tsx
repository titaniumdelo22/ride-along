import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-dvh bg-[#0E0E0E] text-white">
      <div className="relative h-[46vh] min-h-[300px] bg-[url(https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=1200&q=70)] bg-cover bg-center">
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 to-[#0E0E0E]" />
        <div className="absolute left-6 top-6 text-2xl font-extrabold tracking-tight">
          ride<span className="text-[#FF6B1A]">along</span>
        </div>
      </div>
      <div className="relative mx-auto -mt-24 max-w-xl px-6 pb-12">
        <h1 className="text-5xl font-extrabold leading-[1.02] tracking-tight">
          Make DIY fun. Turn anyone into a <span className="text-[#FF6B1A]">tradesman.</span>
        </h1>
        <p className="mt-4 text-lg text-white/75">Point your phone at it. Ray, your AI pro, sees what you see and walks you through it out loud.</p>
        <Link href="/call" className="mt-8 flex h-16 items-center justify-center rounded-full bg-gradient-to-r from-[#FF8A3D] to-[#FF3D6E] text-xl font-black shadow-[0_10px_40px_rgba(255,107,26,.5)]">
          📞 Call Ray
        </Link>
        <Link href="/glasses" className="mt-3 flex h-14 items-center justify-center rounded-full border border-white/25 text-lg font-bold">
          Put on the glasses
        </Link>
        <ul className="mt-10 space-y-5 text-lg">
          <li className="flex gap-4"><span className="text-3xl">🔍</span><span><b>What is this?</b> <span className="text-white/65">Ray names it and labels the parts.</span></span></li>
          <li className="flex gap-4"><span className="text-3xl">🧰</span><span><b>What do I need?</b> <span className="text-white/65">Your tools, before you start.</span></span></li>
          <li className="flex gap-4"><span className="text-3xl">🎮</span><span><b>Fix it, level up.</b> <span className="text-white/65">Step by step, at your speed. Earn XP.</span></span></li>
          <li className="flex gap-4"><span className="text-3xl">🛑</span><span><b>Stay safe.</b> <span className="text-white/65">Ray stops you before you get hurt.</span></span></li>
        </ul>
      </div>
    </main>
  );
}
