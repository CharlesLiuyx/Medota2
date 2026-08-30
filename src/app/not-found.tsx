import Link from "next/link";
import { SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-5 py-20 text-center">
      <div>
        <SearchX className="mx-auto size-10 text-zinc-700" />
        <p className="mt-5 text-[10px] uppercase tracking-[0.24em] text-[#cb5b40]">
          404 · active dataset
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          没有这个英雄 slug
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          详情页不会回退到模糊名称匹配。
        </p>
        <Link
          href="/heroes"
          className="mt-7 inline-block border border-white/12 px-5 py-3 text-xs text-zinc-300 hover:border-white/25 hover:text-white"
        >
          返回英雄总览
        </Link>
      </div>
    </main>
  );
}
