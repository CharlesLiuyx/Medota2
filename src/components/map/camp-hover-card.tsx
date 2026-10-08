"use client";

import { memo, useMemo } from "react";
import { gameLocale } from "@/i18n/config";
import { useLocale, useTranslations } from "@/i18n/provider";
import { campGroupLabel, mapPointLabel } from "@/presentation/map-labels";
import {
  campGroups,
  clockText,
  goldText,
  groupExperience,
  groupGold,
  xpText,
} from "@/domain/map/economy";
import type { MapPoint, MapViewData } from "@/domain/map/schema";

export const CampHoverCard = memo(function CampHoverCard({
  data,
  point,
  time,
  includeChildren,
  gold,
  xp,
}: {
  data: MapViewData;
  point: MapPoint;
  time: number;
  includeChildren: boolean;
  gold: string | null;
  xp: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const economy = data.economy;
  const camp = economy?.camps.find((camp) => camp.pointId === point.id);
  const groups = useMemo(
    () =>
      economy && camp
        ? campGroups(economy, camp, time).map((group) => ({
            group,
            gold: goldText(groupGold(economy, group, time, includeChildren)),
            xp: xpText(groupExperience(economy, group, time, includeChildren)),
          }))
        : [],
    [economy, camp, time, includeChildren],
  );
  const volume = point.properties.volumename?.replace(/^\[PR#\]/, "");
  const zones = data.zones?.filter(
    (zone) => zone.label.replace(/^\[PR#\]/, "") === (volume ?? camp?.name),
  );
  return (
    <section
      aria-label={t("营地组合详情")}
      className="mb-2 space-y-1.5 rounded border border-[#d7b46b]/30 bg-[#17232e] p-2 text-[11px] leading-5"
    >
      <h2 className="font-semibold">{mapPointLabel(point, locale)}</h2>
      <p className="text-[var(--text-muted)]">
        {t("{value0} · 单人清野，经验独享{value1}", {
          value0: clockText(time),
          value1: includeChildren ? t(" · 含分裂体") : "",
        })}
      </p>
      <p className="text-[#e8c781]">
        {t("金币 {value0}", { value0: gold ?? t("未收录") })}
      </p>
      <p className="text-[#a6daf4]">{t("经验 {value0}", { value0: xp })}</p>
      <p>
        {t("叠野：每分钟 {value0}。整分钟前将野怪引出整个刷新体积。", {
          value0: camp?.stack?.map((n) => `:${n}`).join("–") ?? t("未提供"),
        })}
      </p>
      {camp?.pulls.length ? (
        camp.pulls.map((pull) => (
          <p key={pull.team}>
            {t("{value0}拉野：{value1}", {
              value0: pull.team === "radiant" ? t("天辉") : t("夜魇"),
              value1: pull.windows
                .map((window) =>
                  window.map((n) => `:${String(n).padStart(2, "0")}`).join("–"),
                )
                .join(" / "),
            })}
          </p>
        ))
      ) : (
        <p className="text-[var(--text-muted)]">
          {t("该营地的游戏时间表未提供拉兵线时刻。")}
        </p>
      )}
      <p className="break-words font-mono text-[10px]">
        {t("生成点 X {value0} / Y {value1} / Z 轴 {value2}", {
          value0: point.x.toFixed(1),
          value1: point.y.toFixed(1),
          value2: point.z?.toFixed(1) ?? t("未知"),
        })}
      </p>
      {zones?.map((zone) => (
        <p key={zone.id}>
          {t("Z 轴范围：{value0}～{value1}", {
            value0: zone.zMin?.toFixed(1) ?? t("未知"),
            value1: zone.zMax?.toFixed(1) ?? t("未知"),
          })}
        </p>
      ))}
      {groups.map(({ group, gold, xp }) => (
        <div key={group.id} className="border-t border-white/10 pt-1.5">
          <p className="font-semibold">{campGroupLabel(group.label, locale)}</p>
          <p>
            {t("{value0} 金 · {value1}", {
              value0: gold,
              value1: t("{value0} 经验", { value0: xp }),
            })}
          </p>
          {[...group.members, ...(includeChildren ? group.children : [])].map(
            (member) => (
              <p key={member.unit} className="text-[var(--text-muted)]">
                {data.unitNames?.[member.unit]?.[gameLocale(locale)] || (
                  <span lang="zh-CN" data-source-text="">
                    {economy!.units[member.unit].name} ({t("中文")})
                  </span>
                )}
                {group.children.some((child) => child.unit === member.unit)
                  ? t("（分裂体）")
                  : ""}{" "}
                ×{member.count}
              </p>
            ),
          )}
        </div>
      ))}
    </section>
  );
});
