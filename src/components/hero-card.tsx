"use client";
import { memo } from "react";

import type { HeroCardRow } from "@/server/repositories/heroes";
import { labels, displayName } from "@/presentation/dota";
import { HeroCrest } from "./hero-crest";
import { HoverTooltip } from "./ui/hover-tooltip";
export const HeroCard = memo(function HeroCard({
  hero,
  assetVersion,
  lang = "zh-CN",
}: {
  hero: HeroCardRow;
  assetVersion: string;
  lang?: "zh-CN" | "en";
}) {
  const name = displayName(
    lang === "en" ? hero.enName : hero.zhName,
    "英雄名称待补充",
  );
  return (
    <HoverTooltip
      href={`/heroes/${hero.slug}${lang === "en" ? "?lang=en" : ""}`}
      className="group block h-full overflow-hidden bg-[#182127] transition-colors hover:bg-[#25313a]"
      content={
        <HeroSummary hero={hero} name={name} assetVersion={assetVersion} />
      }
    >
      <div className="relative">
        <HeroCrest
          name={hero.enName}
          attribute={hero.primaryAttribute}
          portrait
          src={`/valve-assets/hero/${hero.internalName}?v=${encodeURIComponent(assetVersion)}`}
        />
        <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/50 to-transparent px-1 pb-0.5 pt-3">
          <h3 className="text-[11px] font-semibold leading-[13px] text-white">
            {name}
          </h3>
        </div>
      </div>
    </HoverTooltip>
  );
});

function HeroSummary({
  hero,
  name,
  assetVersion,
}: {
  hero: HeroCardRow;
  name: string;
  assetVersion: string;
}) {
  return (
    <>
      <div className="flex items-center gap-2.5">
        <HeroCrest
          name={name}
          attribute={hero.primaryAttribute}
          src={`/valve-assets/hero/${hero.internalName}?v=${encodeURIComponent(assetVersion)}`}
        />
        <div className="min-w-0">
          <p className="text-base font-semibold leading-5 text-white">{name}</p>
          <p
            className="mt-1 text-[11px]"
            style={{ color: `var(--attribute-${hero.primaryAttribute})` }}
          >
            ◆ {labels[hero.primaryAttribute]}{" "}
            <span className="text-[#b9c2c7]">· {labels[hero.attackType]}</span>
          </p>
        </div>
        <div className="ml-auto shrink-0 text-right text-[10px] text-[#a4adb4]">
          <p>操作难度</p>
          <p
            className="mt-1 tracking-wider text-[#dfbd7e]"
            aria-label={`${hero.complexity} / 3`}
          >
            {"◆".repeat(hero.complexity)}
            {"◇".repeat(3 - hero.complexity)}
          </p>
        </div>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-1">
        {[
          ["strength", "力量", hero.baseStrength],
          ["agility", "敏捷", hero.baseAgility],
          ["intelligence", "智力", hero.baseIntelligence],
        ].map(([key, label, value]) => (
          <div
            key={key}
            className="flex items-baseline justify-between bg-black/20 px-2 py-1.5"
            style={{ color: `var(--attribute-${key})` }}
          >
            <span className="text-[10px] text-[#b9c2c7]">{label}</span>
            <strong className="font-data text-lg leading-5">
              {Number(value)}
            </strong>
          </div>
        ))}
      </div>
      {hero.roles.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
          {hero.roles.map((r) => (
            <div
              key={r.role}
              className="flex items-center justify-between text-[11px]"
            >
              <span className="text-[#ccd2d6]">{labels[r.role]}</span>
              <span className="flex gap-0.5" aria-label={`${r.level} / 3`}>
                {[1, 2, 3].map((level) => (
                  <span
                    key={level}
                    className={`h-1 w-3 ${level <= r.level ? "bg-[#c4a16a]" : "bg-white/10"}`}
                  />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between pt-2 text-[11px]">
        <span className="text-[#a4adb4]">
          移动速度{" "}
          <strong className="ml-1 font-data text-[#e2e8ec]">
            {Number(hero.movementSpeed)}
          </strong>
        </span>
        <span className="text-[#dfbd7e]">点击查看技能与天赋 →</span>
      </div>
    </>
  );
}
