"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const entities = [
  { href: "/heroes", label: "Heroes", match: "/heroes" },
  { href: "/abilities", label: "Abilities", match: "/abilities" },
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
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-11 items-center px-4 text-xs font-semibold uppercase tracking-[0.14em] sm:px-5 ${active ? "text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}
          >
            {entity.label}
            {active && (
              <span className="absolute inset-x-4 bottom-0 h-px bg-[var(--accent-primary)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
