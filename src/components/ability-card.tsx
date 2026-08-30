import Link from "next/link";
import { ArrowUpRight, Clock3, Droplets, Gem } from "lucide-react";
import type { AbilityCardRow } from "@/server/repositories/abilities";
import { AbilityIcon } from "./ability-icon";
import { Badge } from "./ui/badge";

const statusTone = {
  current: "success",
  indirect: "accent",
  defined_unbound: "neutral",
  template: "warning",
  deprecated: "danger",
} as const;

export function AbilityCard({
  ability,
  lang,
}: {
  ability: AbilityCardRow;
  lang: "en" | "zh-CN";
}) {
  return (
    <Link
      href={`/abilities/${ability.internalName}${lang === "en" ? "?lang=en" : ""}`}
      className="group flex min-h-52 flex-col bg-[var(--surface-panel)] p-4 hover:z-10 hover:-translate-y-0.5 hover:bg-[var(--surface-hover)] hover:shadow-[var(--shadow-elevated)]"
    >
      <div className="flex gap-3">
        <AbilityIcon
          internalName={ability.internalName}
          name={ability.displayName}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="line-clamp-2 font-semibold text-[var(--text-primary)]">
              {ability.displayName}
            </h2>
            <ArrowUpRight className="size-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-hover)]" />
          </div>
          {ability.fallbackName && (
            <p className="mt-1 text-[10px] text-[var(--status-warning)]">
              English fallback
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge
              tone={
                statusTone[ability.catalogStatus as keyof typeof statusTone] ??
                "neutral"
              }
            >
              {ability.catalogStatus}
            </Badge>
            {ability.isInnate && <Badge tone="accent">Innate</Badge>}
            {ability.isUltimate && <Badge tone="danger">Ultimate</Badge>}
            {ability.isPassive && <Badge>Passive</Badge>}
          </div>
        </div>
      </div>
      <code className="mt-4 break-all text-[9px] text-[var(--text-muted)]">
        {ability.internalName}
      </code>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[10px] text-[var(--text-secondary)]">
        {ability.cooldown && (
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-3" /> {ability.cooldown}
          </span>
        )}
        {ability.manaCost && (
          <span className="inline-flex items-center gap-1">
            <Droplets className="size-3" /> {ability.manaCost}
          </span>
        )}
        {(ability.hasScepterUpgrade || ability.hasShardUpgrade) && (
          <span className="inline-flex items-center gap-1">
            <Gem className="size-3" />
            {ability.hasScepterUpgrade && "Scepter"}
            {ability.hasScepterUpgrade && ability.hasShardUpgrade && " + "}
            {ability.hasShardUpgrade && "Shard"}
          </span>
        )}
      </div>
      <p className="mt-auto border-t border-[var(--border-subtle)] pt-3 text-[10px] text-[var(--text-muted)]">
        {ability.owners.length
          ? ability.owners
              .slice(0, 3)
              .map((owner) => owner.displayName)
              .join(" · ")
          : "No current Hero owner"}
      </p>
    </Link>
  );
}
