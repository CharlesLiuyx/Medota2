import Link from "next/link";
import { ArrowUpRight, Swords } from "lucide-react";
import type { HeroCardRow } from "@/server/repositories/heroes";
import { Badge, type BadgeTone } from "./ui/badge";
import { HeroCrest } from "./hero-crest";

const attributeLabel: Record<string, string> = {
  strength: "力量",
  agility: "敏捷",
  intelligence: "智力",
  universal: "全才",
};

const roleLabel: Record<string, string> = {
  carry: "核心",
  support: "辅助",
  nuker: "爆发",
  disabler: "控制",
  durable: "耐久",
  escape: "逃生",
  pusher: "推进",
  initiator: "先手",
};

export function HeroCard({
  hero,
  assetVersion,
  lang = "zh-CN",
}: {
  hero: HeroCardRow;
  assetVersion: string;
  lang?: "zh-CN" | "en";
}) {
  return (
    <Link
      href={`/heroes/${hero.slug}${lang === "en" ? "?lang=en" : ""}`}
      className="group relative flex min-h-40 flex-col bg-[var(--surface-panel)] p-4 hover:z-10 hover:-translate-y-0.5 hover:bg-[var(--surface-hover)] hover:shadow-[var(--shadow-elevated)]"
    >
      <div className="flex items-start gap-3">
        <HeroCrest
          name={hero.enName}
          attribute={hero.primaryAttribute}
          src={`/valve-assets/hero/${hero.internalName}?v=${encodeURIComponent(assetVersion)}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight text-[var(--text-primary)]">
                {lang === "en" ? hero.enName : hero.zhName}
              </h3>
              <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                {lang === "en" ? hero.zhName : hero.enName}
              </p>
            </div>
            <ArrowUpRight className="size-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-hover)]" />
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge tone={hero.primaryAttribute as BadgeTone}>
              {attributeLabel[hero.primaryAttribute]}
            </Badge>
            <Badge>
              <Swords className="size-2.5" aria-hidden="true" />
              {hero.attackType === "melee" ? "近战" : "远程"}
            </Badge>
          </div>
        </div>
      </div>
      <p className="mt-3 line-clamp-1 text-[10px] text-[var(--text-muted)]">
        {hero.roles
          .slice(0, 4)
          .map((role) => `${roleLabel[role.role] ?? role.role} ${role.level}`)
          .join(" · ")}
      </p>
      <div className="mt-auto flex items-end justify-between border-t border-[var(--border-subtle)] pt-3">
        <code className="truncate pr-4 text-[9px] text-[var(--text-muted)]">
          {hero.internalName}
        </code>
        <span className="shrink-0 font-data text-[9px] tabular-nums text-[var(--text-muted)]">
          #{hero.heroId}
          {!hero.cmEnabled && " · 非 CM"}
        </span>
      </div>
    </Link>
  );
}
