import Link from "next/link";
import { SearchX } from "lucide-react";

export default function AbilityNotFound() {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-5 py-20 text-center">
      <div>
        <SearchX className="mx-auto size-10 text-[var(--text-muted)]" />
        <p className="mt-5 text-[10px] uppercase tracking-[0.24em] text-[var(--accent-hover)]">
          404 · active catalog
        </p>
        <h1 className="mt-2 text-3xl font-semibold">
          没有这个 Ability internal name
        </h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          详情页不会做模糊 fallback。
        </p>
        <Link
          href="/abilities"
          className="mt-7 inline-block border border-[var(--border-default)] px-5 py-3 text-xs hover:border-[var(--border-strong)]"
        >
          返回 Abilities
        </Link>
      </div>
    </main>
  );
}
