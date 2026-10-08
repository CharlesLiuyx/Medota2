"use client";
import { DataTable } from "@/components/ui/data-table";
import { gameLocale } from "@/i18n/config";
import { useLocale } from "@/i18n/provider";
import { mapPointLabel, campGroupLabel } from "@/presentation/map-labels";
import { Message, useTranslations } from "@/i18n/provider";

import { CompactSelect } from "@/components/ui/compact-select";
import { useState } from "react";
import type { MapViewData, MapPoint } from "@/domain/map/schema";
import {
  BARRACKS_LABELS,
  campGold,
  campGroups,
  clockText,
  goldText,
  groupGold,
  campExperience,
  groupExperience,
  unitExperience,
  xpText,
  laneWave,
  type BarracksState,
} from "@/domain/map/economy";
const control =
  "rounded border border-white/20 bg-[#20303d] px-2 py-1.5 text-xs text-[#edf5fc] [color-scheme:dark] [&>option]:bg-[#17232e] [&>option]:text-[#edf5fc]";
export function MapEconomyPanel({
  data,
  time,
  onTime,
  selected,
  onFocus,
  onHover,
  state,
  onState,
  includeChildren,
  onIncludeChildren,
}: {
  data: MapViewData;
  time: number;
  onTime(value: number): void;
  selected: MapPoint | null;
  onFocus(point: MapPoint): void;
  onHover(point: MapPoint | null): void;
  state: BarracksState;
  onState(state: BarracksState): void;
  includeChildren: boolean;
  onIncludeChildren(value: boolean): void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [team, setTeam] = useState<"radiant" | "dire">("radiant");
  const [lane, setLane] = useState("mid");
  const economy = data.economy;
  if (!economy)
    return (
      <p className="mt-4 rounded bg-white/[0.025] p-3 text-xs text-[var(--text-muted)]">
        {t(
          "此版本尚无匹配的野怪组合、拉野时刻与兵线收益数据，不使用其他版本数值。刷新区域按现有来源显示；缺失的Z保持未知。",
        )}
      </p>
    );
  const camp = economy.camps.find((c) => c.pointId === selected?.id),
    wave = laneWave(economy, time, state, team);
  const zones = camp
    ? (data.zones?.filter(
        (z) => z.label.replace(/^\[PR#\]/, "") === camp.name,
      ) ?? [])
    : [];
  const route = data.lanePaths?.find((p) => p.lane === lane && p.team === team);
  return (
    <section
      aria-label={t("野区与兵线收益")}
      className="mt-4 grid gap-4 text-xs xl:grid-cols-2"
    >
      <section className="min-w-0 rounded border border-white/10 bg-[#101820] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            <Message
              id="野区 · {value0} 的清野收益"
              values={{
                value0: clockText(time),
              }}
            />
          </h2>
          <label>
            <Message
              id="{value0}计入泥土傀儡分裂体"
              values={{
                value0: (
                  <input
                    type="checkbox"
                    checked={includeChildren}
                    onChange={(e) => onIncludeChildren(e.target.checked)}
                    className="mr-2"
                  />
                ),
              }}
            />
          </label>
        </div>
        <p className="mb-3 leading-5 text-[var(--text-muted)]">
          {t(
            "首次1:00，之后每分钟尝试刷新；刷新体积内有阻挡则不刷新。金币按全部补刀、经验按单人独享整组计算；未计叠野减益、堆野者奖励、炼金或点金等修正。",
          )}
        </p>
        <div className="max-h-52 overflow-auto rounded border border-white/5">
          <DataTable
            className="w-full text-left tabular-nums"
            aria-label={t("各营地金币与经验收益")}
          >
            <thead className="sticky top-0 bg-[#18212a]">
              <tr>
                <th className="p-2">{t("营地 · 点击定位")}</th>
                <th>{t("金币范围")}</th>
                <th>{t("经验")}</th>
                <th>{t("叠野秒数")}</th>
              </tr>
            </thead>
            <tbody>
              {economy.camps.map((c) => {
                const p = data.points.find((p) => p.id === c.pointId)!;
                const gold = campGold(economy, c, time, includeChildren);
                return (
                  <tr
                    key={c.pointId}
                    className={
                      camp?.pointId === c.pointId
                        ? "bg-white/10"
                        : "border-t border-white/5"
                    }
                  >
                    <td className="p-2">
                      <button
                        className="text-left hover:underline"
                        onClick={() => onFocus(p)}
                        onPointerEnter={() => onHover(p)}
                        onPointerLeave={() => onHover(null)}
                        onFocus={() => onHover(p)}
                        onBlur={() => onHover(null)}
                      >
                        {mapPointLabel(p, locale)}
                        <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                          {c.name.replace("neutralcamp_", "")}
                        </span>
                      </button>
                    </td>
                    <td className="text-[#e8c781]">
                      {gold ? goldText(gold) : t("未收录")}
                    </td>
                    <td className="text-[#a6daf4]">
                      {xpText(
                        campExperience(economy, c, time, includeChildren),
                      )}
                    </td>
                    <td>{c.stack?.join("–") ?? t("未提供")}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </div>
        {camp ? (
          <div className="mt-4" aria-label={t("营地组合详情")}>
            <h3 className="font-semibold">
              {mapPointLabel(selected!, locale)} ·{" "}
              {camp.name.replace("neutralcamp_", "")}
            </h3>
            <p className="mt-2 font-mono text-[11px]">
              <Message
                id="生成点 X {value0} / Y {value1} / Z 轴 {value2}"
                values={{
                  value0: selected!.x.toFixed(1),
                  value1: selected!.y.toFixed(1),
                  value2: selected!.z?.toFixed(1) ?? t("未知"),
                }}
              />
            </p>
            {zones.map((z) => (
              <details key={z.id} className="mt-2 rounded bg-white/5 p-2">
                <summary className="cursor-pointer">
                  <Message
                    id="刷新体积 Z 轴范围：{value0}～{value1} · 查看XYZ顶点"
                    values={{
                      value0: z.zMin?.toFixed(1) ?? t("未知"),
                      value1: z.zMax?.toFixed(1) ?? t("未知"),
                    }}
                  />
                </summary>
                <p className="mt-2 font-mono text-[10px]">
                  {z.worldVertices?.map((v, i) => (
                    <span key={i} className="block">
                      {v.x.toFixed(1)}, {v.y.toFixed(1)}, {v.z.toFixed(1)}
                    </span>
                  )) ?? t("此来源只有二维边界")}
                </p>
              </details>
            ))}
            <p className="mt-3">
              <Message
                id="叠野：每分钟 {value0}。整分钟前将野怪引出整个刷新体积。"
                values={{
                  value0:
                    camp.stack?.map((n) => `:${n}`).join("–") ?? t("未提供"),
                }}
              />
            </p>
            {camp.pulls.length ? (
              camp.pulls.map((p) => (
                <p className="mt-1" key={p.team}>
                  <Message
                    id="{value0}拉野：{value1}"
                    values={{
                      value0: p.team === "radiant" ? t("天辉") : t("夜魇"),
                      value1: p.windows
                        .map((w) =>
                          w
                            .map((n) => `:${String(n).padStart(2, "0")}`)
                            .join("–"),
                        )
                        .join(" / "),
                    }}
                  />
                </p>
              ))
            ) : (
              <p className="mt-1 text-[var(--text-muted)]">
                {t("该营地的游戏时间表未提供拉兵线时刻。")}
              </p>
            )}
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {t(
                "来自本版本游戏提示表；实际成功率受路线、树木、单位移速和叠数影响。方向字段保留在Dataset，未把提示箭头当作可通行路径。",
              )}
            </p>
            {camp.minType === 7 && (
              <p className="mt-2 text-[#e8c781]">
                <Message
                  id="洪流营地每5分钟升级一个单位，最多{value0}轮。以下为未被封野、正常刷新的进化组合；阻挡或未清理可能使实际进度落后。"
                  values={{
                    value0: camp.maxUpgrade,
                  }}
                />
              </p>
            )}
            <div className="mt-3 space-y-2">
              {campGroups(economy, camp, time).map((g) => (
                <details
                  key={g.id}
                  className="rounded bg-white/5 p-2"
                  open={campGroups(economy, camp, time).length === 1}
                >
                  <summary className="cursor-pointer">
                    <strong>{campGroupLabel(g.label, locale)}</strong>
                    <span className="float-right text-[#e8c781]">
                      <Message
                        id="{value0} 金 · {value1}"
                        values={{
                          value0: goldText(
                            groupGold(economy, g, time, includeChildren),
                          ),
                          value1: (
                            <span className="text-[#a6daf4]">
                              <Message
                                id="{value0} 经验"
                                values={{
                                  value0: xpText(
                                    groupExperience(
                                      economy,
                                      g,
                                      time,
                                      includeChildren,
                                    ),
                                  ),
                                }}
                              />
                            </span>
                          ),
                        }}
                      />
                    </span>
                  </summary>
                  <DataTable className="mt-2 w-full text-left tabular-nums">
                    <thead>
                      <tr>
                        <th>{t("单位")}</th>
                        <th>{t("数量")}</th>
                        <th>{t("单体金币")}</th>
                        <th>{t("单体经验")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...g.members,
                        ...(includeChildren ? g.children : []),
                      ].map((m) => (
                        <tr key={m.unit}>
                          <td className="py-1">
                            {data.unitNames?.[m.unit]?.[gameLocale(locale)] || (
                              <span
                                lang="zh-CN"
                                data-source-text=""
                                title={t("原文：{language}", {
                                  language: t("中文"),
                                })}
                              >
                                {economy.units[m.unit].name}{" "}
                                <small>({t("中文")})</small>
                              </span>
                            )}
                            {g.children.some((c) => c.unit === m.unit)
                              ? t("（分裂体）")
                              : ""}
                          </td>
                          <td>×{m.count}</td>
                          <td>
                            {goldText(
                              groupGold(
                                economy,
                                {
                                  ...g,
                                  members: [{ ...m, count: 1 }],
                                  children: [],
                                },
                                time,
                                false,
                              ),
                            )}
                          </td>
                          <td>
                            {unitExperience(economy, m.unit, time) ??
                              t("未收录")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                  {g.spawnType === 2 && g.tier === 2 && (
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                      {t("不计黑暗巨魔主动召唤的骷髅，其数量取决于战斗过程。")}
                    </p>
                  )}
                </details>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[var(--text-muted)]">
            {t(
              "点击地图上的营地或上表，查看刷新体积、拉野时间和全部可能组合。",
            )}
          </p>
        )}
      </section>
      <section
        className="min-w-0 rounded border border-white/10 bg-[#101820] p-4"
        aria-label={t("兵线收益计算")}
      >
        <h2 className="mb-3 font-semibold">{t("兵线 · 出生时间与兵营状态")}</h2>
        <div className="flex flex-wrap gap-2">
          <CompactSelect
            hideLabel
            label={t("兵线阵营")}
            className="map-select"
            value={team}
            onValueChange={(value) => setTeam(value as typeof team)}
          >
            <option value="radiant">{t("天辉出兵")}</option>
            <option value="dire">{t("夜魇出兵")}</option>
          </CompactSelect>
          <CompactSelect
            hideLabel
            label={t("兵线路线")}
            className="map-select"
            value={lane}
            onValueChange={(value) => setLane(value)}
          >
            <option value="top">{t("上路")}</option>
            <option value="mid">{t("中路")}</option>
            <option value="bot">{t("下路")}</option>
          </CompactSelect>
          <CompactSelect
            hideLabel
            label={t("兵营状态")}
            className="map-select"
            value={state}
            onValueChange={(value) => onState(value as BarracksState)}
          >
            {Object.entries(BARRACKS_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {t(label)}
              </option>
            ))}
          </CompactSelect>
        </div>
        <p className="mt-2 leading-5 text-[var(--text-muted)]">
          {t(
            "兵营状态指所选出兵阵营的敌方兵营；摧毁敌方近战／远程兵营会强化己方对应兵种。本路两座被毁与全部六座被毁是不同状态。",
          )}
        </p>
        <div className="my-4 flex items-center justify-between gap-2">
          <button
            className={control}
            aria-label={t("上一波")}
            disabled={time === 0}
            onClick={() => onTime(Math.max(0, wave.time - 30))}
          >
            {t("← 上一波")}
          </button>
          <strong className="tabular-nums">
            <Message
              id="{value0} · 第{value1}波"
              values={{
                value0: clockText(wave.time),
                value1: wave.number,
              }}
            />
          </strong>
          <button
            className={control}
            aria-label={t("下一波")}
            disabled={time >= 7200}
            onClick={() => onTime(Math.min(7200, wave.time + 30))}
          >
            {t("下一波 →")}
          </button>
        </div>
        <div className="mb-3 rounded bg-[#dcc08310] p-3">
          <span className="text-[var(--text-muted)]">
            {t("单人全补刀 · 含旗手额外奖励")}
          </span>
          <strong
            className="ml-3 text-lg tabular-nums text-[#e8c781]"
            data-wave-gold
          >
            <Message
              id="{value0} 金"
              values={{
                value0: goldText(wave.total),
              }}
            />
          </strong>
          <strong
            className="ml-3 text-lg tabular-nums text-[#a6daf4]"
            data-wave-xp
          >
            <Message
              id="{value0} 经验"
              values={{
                value0: wave.xp ?? t("未收录"),
              }}
            />
          </strong>
        </div>
        <DataTable className="w-full text-left tabular-nums">
          <thead>
            <tr>
              <th>{t("兵种")}</th>
              <th>{t("数量")}</th>
              <th>{t("单体金币")}</th>
              <th>{t("本波金币")}</th>
              <th>{t("经验")}</th>
            </tr>
          </thead>
          <tbody>
            {wave.rows.map((r) => (
              <tr key={r.id} className="border-b border-white/5">
                <td className="py-2">{t(r.label)}</td>
                <td>×{r.count}</td>
                <td>{goldText(r.direct)}</td>
                <td>{goldText(r.total)}</td>
                <td>{r.totalXp ?? t("未收录")}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <p className="mt-3">
          <Message
            id="单位悬赏 {value0}；旗手额外奖励 {value1}。"
            values={{
              value0: goldText(wave.direct),
              value1: goldText(wave.flagBonus),
            }}
          />
        </p>
        <p className="mt-2 text-[10px] leading-5 text-[var(--text-muted)]">
          {t(
            "经验按范围内单人独享整波计算，不要求补刀；多人会分摊，反补及其他修正未计。旗手额外奖励只增加金币。远程兵每7分30秒增加8经验；中立单位按同版本升级技能每次增加5经验（仅适用于拥有该技能的单位）。",
          )}
        </p>
        <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
          {t(
            "标准模式，金币区间为规则计算值，未逐项实机结算验证。只计算击杀该波小兵的玩家；不把附近队友获得的旗手奖励累加。时间指小兵出生时刻，不是到达线上或死亡时刻；未计反补、技能、装备和极速模式。",
          )}
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer">{t("出兵与收益规则")}</summary>
          <p className="mt-2 leading-6">
            {t(
              "0:00起每30秒一波；15/30/45分钟各增加1近战兵，40分钟增加1远程兵；2:00起整分钟旗手替换1近战兵。5:00起每5分钟出攻城车，30分钟增至2辆，60分钟增至3辆。每7:30普通近战／旗手+1金，普通／强化远程+3金；强化近战及超级兵按其基础悬赏计算。",
            )}
          </p>
        </details>
        {route && (
          <details className="mt-3">
            <summary className="cursor-pointer">
              <Message
                id="兵线路径 · {value0}个XYZ路径点"
                values={{
                  value0: route.vertices.length,
                }}
              />
            </summary>
            <p className="mt-2 font-mono text-[10px]">
              {route.vertices.map((p, i) => (
                <span className="block" key={i}>
                  {i === 0 ? t("出生点 ") : ""}
                  {p.x}, {p.y}, {p.z}
                </span>
              ))}
            </p>
            <p className="mt-2 text-[var(--text-muted)]">
              {t("地图中的虚线连接原生路径点，不代表单位实时轨迹或到线时间。")}
            </p>
          </details>
        )}
        <details className="mt-4 text-[10px] text-[var(--text-muted)]">
          <summary className="cursor-pointer">{t("版本与数据来源")}</summary>
          <p className="mt-2">
            <Message
              id="{value0} / 客户端{value1}。单位悬赏、中文名、拉野表、原生营地及路径取自同一安装；组合数量和时间规则为按补丁审阅的独立模型。"
              values={{
                value0: economy.patch,
                value1: economy.clientVersion,
              }}
            />
          </p>
          {economy.sources.map((s) => (
            <a
              key={s.url}
              className="mt-1 block underline"
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              {t(s.label)}
            </a>
          ))}
        </details>
      </section>
    </section>
  );
}
