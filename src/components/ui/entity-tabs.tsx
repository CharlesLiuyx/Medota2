"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const entities = [
  { href: "/heroes", label: "英雄", match: "/heroes" },
  { href: "/abilities", label: "技能", match: "/abilities" },
  { href: "/units", label: "单位", match: "/units" },
  { href: "/map", label: "地图", match: "/map" },
] as const;

export function EntityTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Catalog entities" className="flex h-full items-stretch">
      {entities.map((entity) => {
        const active = pathname.startsWith(entity.match);
        return (
          <Link
            key={entity.href}
            href={entity.href}
            prefetch={true}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-10 items-center px-2.5 text-xs font-semibold uppercase tracking-[0.14em] sm:px-3 ${active ? "bg-white/5 text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          >
            {entity.label}
          </Link>
        );
      })}
    </nav>
  );
}
