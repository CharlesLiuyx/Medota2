"use client";

import { HeroReferenceText } from "./hero-reference-text";
import { Check, ExternalLink } from "lucide-react";
import type {
  HeroBuildState,
  HeroTalent,
  TalentTier,
} from "@/domain/hero-build";
import { secondTalentLevel } from "@/domain/hero-build";
import { useTranslations } from "@/i18n/provider";
import Link from "./version-link";
import { PageInfoTooltip } from "./ui/page-info-tooltip";

/** Controlled view; all eligibility and selection transitions live in hero-build. */
export function HeroTalentTree({
  talents,
  build,
  onToggle,
  onClear,
  embedded = false,
}: {
  talents: readonly HeroTalent[];
  build: HeroBuildState;
  onToggle: (id: string) => void;
  onClear: () => void;
  embedded?: boolean;
}) {
  const t = useTranslations();
  const selected = talents.filter((talent) =>
    build.selectedTalents.includes(talent.id),
  );
  return (
    <section
      id="talents"
      className={embedded ? "col-span-full min-w-0 pt-1" : "dota-panel min-w-0"}
    >
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium text-[#d8c49a]">{t("天赋树")}</h2>
        <PageInfoTooltip label={t("天赋选择说明")}>
          {t(
            "点空白处选中／取消，点技能名定位；等级不足自动升级。每层选一项，27–30级依次解锁10／15／20／25级双选。降级清除失效项；双选失效保留先选项。",
          )}
        </PageInfoTooltip>
        <button
          type="button"
          onClick={onClear}
          disabled={!selected.length}
          className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[#e4c584] disabled:opacity-35"
        >
          {t("清除选择")}
        </button>
      </div>
      <div className="grid gap-1">
        {([25, 20, 15, 10] as TalentTier[]).map((level) => (
          <div
            key={level}
            className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-stretch gap-1"
          >
            {([0, 1] as const).map((side) => {
              const talent = talents.find(
                (entry) => entry.level === level && entry.side === side,
              );
              const chosen = talent
                ? build.selectedTalents.includes(talent.id)
                : false;
              return (
                <div
                  key={side}
                  className={`relative row-start-1 flex min-w-0 items-stretch border ${side === 0 ? "col-start-1" : "col-start-3"} ${chosen ? "border-[#d8bc7f]/60 bg-[#d8bc7f]/15" : "border-transparent bg-black/20"}`}
                >
                  {talent ? (
                    <>
                      <div className="relative flex min-h-11 min-w-0 flex-1 items-center justify-center">
                        <button
                          type="button"
                          aria-pressed={chosen}
                          aria-label={talent.name}
                          onClick={() => onToggle(talent.id)}
                          className="absolute inset-0 hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[#e4c584]"
                        />
                        {chosen && (
                          <Check
                            size={10}
                            aria-hidden="true"
                            className="pointer-events-none absolute left-0.5 top-0.5 text-[#f3d58e]"
                          />
                        )}
                        <span
                          className={`pointer-events-none relative px-2 py-1.5 text-center text-[11px] leading-snug [overflow-wrap:anywhere] ${chosen ? "text-[#f3d58e]" : "text-[#d5c7a9]"}`}
                        >
                          <HeroReferenceText text={talent.name} />
                        </span>
                      </div>
                      <Link
                        href={`/abilities/${talent.id}`}
                        aria-label={t("查看天赋详情：{name}", {
                          name: talent.name,
                        })}
                        className="flex w-5 shrink-0 items-center justify-center text-[#8d8c83] hover:text-[#e4c584] focus-visible:outline-2 focus-visible:outline-[#e4c584]"
                      >
                        <ExternalLink size={10} aria-hidden="true" />
                      </Link>
                    </>
                  ) : (
                    <span className="p-2 text-[11px] text-[var(--text-muted)]">
                      {t("天赋说明待补充")}
                    </span>
                  )}
                </div>
              );
            })}
            <span
              className={`col-start-2 row-start-1 grid h-6 w-6 self-center place-items-center rounded-full text-xs font-semibold ${build.level >= level ? "bg-[#3b3423] text-[#e4bb69]" : "bg-[#202019] text-[#8b816b]"}`}
              title={t("{level}级可双选", { level: secondTalentLevel(level) })}
            >
              {level}
            </span>
          </div>
        ))}
      </div>
      <div
        aria-live="polite"
        className="mt-2 space-y-1 text-[10px] text-[var(--text-secondary)]"
      >
        {selected.length > 0 && (
          <p>{t("已选 {count} 项天赋", { count: selected.length })}</p>
        )}
        {selected
          .filter((talent) => talent.coverage !== "stats")
          .map((talent) => (
            <p key={talent.id} className="leading-relaxed">
              {talent.name}：
              {t(
                talent.coverage === "ability"
                  ? "技能修正见对应技能卡；条件缺项会标明，未计入基础面板"
                  : "该效果尚未纳入属性计算",
              )}
            </p>
          ))}
      </div>
    </section>
  );
}
