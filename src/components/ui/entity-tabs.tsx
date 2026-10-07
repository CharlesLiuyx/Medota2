"use client";

import Link from "@/components/version-link";
import { useTranslations } from "@/i18n/provider";
import { usePathname } from "next/navigation";

const entities = [
  { href: "/heroes", label: "英雄", match: "/heroes" },
  { href: "/abilities", label: "技能", match: "/abilities" },
  { href: "/units", label: "单位", match: "/units" },
  { href: "/items", label: "物品", match: "/items" },
  { href: "/attributes", label: "属性", match: "/attributes" },
  { href: "/map", label: "地图", match: "/map" },
  { href: "/changes", label: "变化", match: "/changes" },
] as const;

export function EntityTabs() {
  const pathname = usePathname();
  const t = useTranslations();
  return (
    <nav
      aria-label={t("图鉴分类")}
      className="flex h-full min-w-0 items-stretch overflow-x-auto"
    >
      {entities.map((entity) => {
        const active = pathname.startsWith(entity.match);
        return (
          <Link
            key={entity.href}
            href={entity.href}
            prefetch={true}
            aria-current={active ? "page" : undefined}
            className={`relative flex shrink-0 min-h-7 items-center px-1.5 text-xs font-semibold uppercase tracking-[0.14em] sm:px-3 ${active ? "bg-white/5 text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          >
            {t(entity.label)}
          </Link>
        );
      })}
    </nav>
  );
}
