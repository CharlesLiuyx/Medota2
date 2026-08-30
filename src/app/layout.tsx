import type { Metadata } from "next";
import Link from "next/link";
import { Database, GitBranch } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Medota2", template: "%s · Medota2" },
  description: "可追溯的 Dota 2 英雄元数据浏览器",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="border-b border-white/8 bg-black/20 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
            <Link
              href="/heroes"
              className="group flex items-center gap-3"
              aria-label="Medota2 英雄总览"
            >
              <span className="grid size-9 place-items-center border border-[#d85a3a]/50 bg-[#d85a3a]/10 text-[#ef7b5e] group-hover:bg-[#d85a3a]/20">
                <span className="text-sm font-black tracking-[-0.16em]">
                  M2
                </span>
              </span>
              <span>
                <span className="block text-[15px] font-semibold tracking-[0.18em] text-white">
                  MEDOTA2
                </span>
                <span className="block text-[9px] uppercase tracking-[0.24em] text-zinc-500">
                  source of truth explorer
                </span>
              </span>
            </Link>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Database className="size-3.5" />
              <span className="hidden sm:inline">PostgreSQL · VPK SSOT</span>
              <a
                href="https://github.com/CharlesLiuyx/Medota2"
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                className="ml-3 rounded-full border border-white/10 p-2 text-zinc-400 hover:border-white/20 hover:text-white"
              >
                <GitBranch className="size-4" />
              </a>
            </div>
          </div>
        </header>
        {children}
        <footer className="mx-auto flex max-w-[1480px] flex-col gap-2 border-t border-white/8 px-5 py-8 text-xs text-zinc-600 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <p>非官方社区项目。规范字段仅来自固定 dota_vpk_updates 快照。</p>
          <p>Valve、Dota 2 及相关商标归其权利人所有。</p>
        </footer>
      </body>
    </html>
  );
}
