"use client";
import { useLocale } from "@/i18n/provider";
import { Message, useTranslations } from "@/i18n/provider";
import { memo } from "react";
import {
  displayName,
  numbers,
  relationLabel,
  enumText,
  behaviorLabels,
} from "@/presentation/dota";
import type { AbilityCardRow } from "@/server/repositories/abilities";
import { AbilityIcon } from "./ability-icon";
import { HoverTooltip } from "./ui/hover-tooltip";
export const AbilityCard = memo(function AbilityCard({
  ability,
  assetVersion,
}: {
  ability: AbilityCardRow;
  assetVersion: string;
  lang: "en" | "zh-CN";
}) {
  const locale = useLocale();
  const t = useTranslations();
  const name = displayName(ability.displayName, undefined, undefined, locale);
  const talentLevels = [
    ...new Set(
      ability.owners.flatMap((owner) =>
        owner.talentLevel == null ? [] : [owner.talentLevel],
      ),
    ),
  ].sort((a, b) => a - b);
  const type =
    ability.definitionKind === "talent"
      ? talentLevels.length
        ? t("{value0} 级天赋", {
            value0: talentLevels.join(" / "),
          })
        : t("天赋 · 等级待确认")
      : ability.isInnate
        ? t("先天")
        : ability.isUltimate
          ? t("终极")
          : ability.isPassive
            ? t("被动")
            : t("主动");
  const owners =
    ability.owners
      .map((owner) =>
        displayName(owner.displayName, t("英雄名称待补充"), undefined, locale),
      )
      .join(" · ") || t("通用技能");
  const costs = !ability.isPassive && ability.definitionKind !== "talent";
  return (
    <HoverTooltip
      href={`/abilities/${ability.internalName}`}
      className="group flex h-[62px] items-center gap-2 overflow-hidden bg-[#182127]/65 p-1.5 hover:bg-[#25313a]"
      content={
        <>
          <div className="flex items-center gap-2">
            <AbilityIcon
              internalName={ability.internalName}
              name={name}
              assetVersion={assetVersion}
              compact
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{name}</p>
              <p className="mt-0.5 text-[10px] text-[#c4a16a]">
                {type} · {relationLabel(ability.catalogStatus, locale)}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-[#aeb9c1]">{owners}</p>
          {(ability.behavior.length > 0 || ability.damageType) && (
            <p className="mt-2 text-[11px] text-[#cbd3d9]">
              {[
                behaviorLabels(ability.behavior, locale).join("、"),
                ability.damageType
                  ? t("{value0}伤害", {
                      value0: enumText(ability.damageType, locale),
                    })
                  : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-[#d8dfe3]">
            {ability.description ||
              (ability.definitionKind === "talent"
                ? name
                : t("效果说明待补充"))}
          </p>
          {costs && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              {ability.cooldown != null && (
                <span>
                  <Message
                    id="◷ 冷却 {value0} 秒"
                    values={{
                      value0: (
                        <strong>{numbers(ability.cooldown, locale)}</strong>
                      ),
                    }}
                  />
                </span>
              )}
              {ability.manaCost != null && (
                <span className="text-[#82bbf2]">
                  <Message
                    id="◆ 魔耗 {value0}"
                    values={{
                      value0: (
                        <strong>{numbers(ability.manaCost, locale)}</strong>
                      ),
                    }}
                  />
                </span>
              )}
            </div>
          )}
          {(ability.hasScepterUpgrade || ability.hasShardUpgrade) && (
            <p className="mt-2 text-[11px] text-[#c4a16a]">
              {[
                ability.hasScepterUpgrade ? t("神杖升级") : "",
                ability.hasShardUpgrade ? t("魔晶升级") : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {ability.fallbackName && (
            <p className="mt-2 text-[10px] text-[var(--status-warning)]">
              {t("暂无中文名称")}
            </p>
          )}
          <p className="mt-2 text-[10px] text-[#aeb9c1]">
            {t("点击查看完整数值与升级说明 →")}
          </p>
        </>
      }
    >
      <AbilityIcon
        internalName={ability.internalName}
        name={name}
        assetVersion={assetVersion}
        compact
      />
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 text-xs font-medium leading-[15px] text-[var(--text-primary)]">
          {name}
        </h2>
        <p className="mt-0.5 truncate text-[10px] leading-[13px] text-[var(--text-muted)]">
          <span className="text-[#b8a27e]">{type}</span> · {owners}
        </p>
      </div>
    </HoverTooltip>
  );
});
