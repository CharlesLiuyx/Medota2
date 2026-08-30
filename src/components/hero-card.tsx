import Link from "next/link";
import { ArrowUpRight, Swords } from "lucide-react";
import type { HeroCardRow } from "@/server/repositories/heroes";
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

export function HeroCard({ hero }: { hero: HeroCardRow }) {
  return (
    <Link
      href={`/heroes/${hero.slug}`}
      className="group relative flex min-h-48 flex-col border border-white/9 bg-[linear-gradient(150deg,rgba(28,31,36,.94),rgba(15,16,19,.96))] p-5 hover:-translate-y-0.5 hover:border-[#d85a3a]/45 hover:shadow-xl hover:shadow-black/35"
    >
      <div className="flex items-start gap-4">
        <HeroCrest name={hero.enName} attribute={hero.primaryAttribute} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="truncate text-lg font-semibold tracking-tight text-white">
                {hero.zhName}
              </h2>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {hero.enName}
              </p>
            </div>
            <ArrowUpRight className="size-4 text-zinc-700 group-hover:text-[#e26a4c]" />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Tag>{attributeLabel[hero.primaryAttribute]}</Tag>
            <Tag>
              <Swords className="size-3" />{" "}
              {hero.attackType === "melee" ? "近战" : "远程"}
            </Tag>
            {!hero.cmEnabled && <Tag muted>非 CM</Tag>}
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {hero.roles.slice(0, 4).map((role) => (
          <span key={role.role}>
            {roleLabel[role.role] ?? role.role} · {role.level}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-end justify-between border-t border-white/7 pt-4">
        <code className="truncate pr-4 text-[10px] text-zinc-600">
          {hero.internalName}
        </code>
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
          #{hero.heroId}
        </span>
      </div>
    </Link>
  );
}

function Tag({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 border px-2 py-1 text-[10px] uppercase tracking-wider ${muted ? "border-zinc-700 text-zinc-500" : "border-white/10 text-zinc-400"}`}
    >
      {children}
    </span>
  );
}
