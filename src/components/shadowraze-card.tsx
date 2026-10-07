"use client";
import { useLocale } from "@/i18n/provider";
import { useTranslations } from "@/i18n/provider";
import { useEffect, useState } from "react";
import { AbilityTooltip } from "./ability-tooltip";
import { numbers, type TooltipAbility } from "@/presentation/dota";
/** One presentation card, retaining each range's complete ability definition. */
export function ShadowrazeCard({
  abilities,
  tokens,
  assetVersion,
  lang,
}: {
  abilities: [TooltipAbility, TooltipAbility, TooltipAbility];
  tokens: Record<string, string>;
  assetVersion: string;
  lang: string;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const restore = () => {
      const index = abilities.findIndex(
        (ability) => window.location.hash === `#skill-${ability.internal_name}`,
      );
      if (index !== -1) setSelected(index);
    };
    const frame = requestAnimationFrame(restore);
    window.addEventListener("hashchange", restore);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", restore);
    };
  }, [abilities]);
  return (
    <div className="relative min-w-0" data-ability-group="shadowraze">
      {abilities.slice(1).map((ability) => (
        <span
          key={ability.internal_name}
          id={`skill-${ability.internal_name}`}
          className="absolute top-0 scroll-mt-[88px]"
          aria-hidden="true"
        />
      ))}
      <AbilityTooltip
        id={`skill-${abilities[0].internal_name}`}
        ability={abilities[selected]}
        tokens={tokens}
        assetVersion={assetVersion}
        lang={lang}
        controls={
          <div
            role="group"
            aria-label={t("毁灭阴影距离")}
            className="mt-1 grid grid-cols-3 gap-1"
          >
            {abilities.map((ability, index) => {
              const range = ability.values.find(
                (value) => value.value_key === "shadowraze_range",
              );
              return (
                <button
                  key={ability.internal_name}
                  type="button"
                  aria-pressed={selected === index}
                  onClick={() => setSelected(index)}
                  className={`flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${selected === index ? "bg-[#b8a27e]/15 text-[#e4c584]" : "bg-black/15 text-[var(--text-muted)] hover:bg-white/5"}`}
                >
                  <span>{[t("近距离"), t("中距离"), t("远距离")][index]}</span>{" "}
                  <strong className="tabular-nums">
                    {numbers(
                      range?.level_values.length
                        ? range.level_values
                        : range?.scalar_value,
                      locale,
                    )}
                  </strong>
                </button>
              );
            })}
          </div>
        }
      />
    </div>
  );
}
