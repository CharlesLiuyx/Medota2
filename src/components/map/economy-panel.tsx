"use client";
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
  const [team, setTeam] = useState<"radiant" | "dire">("radiant");
  const [lane, setLane] = useState("mid");
  const economy = data.economy;
  if (!economy)
    return (
      <p className="mt-4 rounded bg-white/[0.025] p-3 text-xs text-[var(--text-muted)]">
        此版本尚无匹配的野怪组合、拉野时刻与兵线收益数据，不使用其他版本数值。刷新区域按现有来源显示；缺失的Z保持未知。
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
      aria-label="野区与兵线收益"
      className="mt-4 grid gap-4 text-xs xl:grid-cols-2"
    >
      <section className="min-w-0 rounded border border-white/10 bg-[#101820] p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">野区 · {clockText(time)} 的清野收益</h2>
          <label>
            <input
              type="checkbox"
              checked={includeChildren}
              onChange={(e) => onIncludeChildren(e.target.checked)}
              className="mr-2"
            />
            计入泥土傀儡分裂体
          </label>
        </div>
        <p className="mb-3 leading-5 text-[var(--text-muted)]">
          首次1:00，之后每分钟尝试刷新；刷新体积内有阻挡则不刷新。金币按全部补刀、经验按单人独享整组计算；未计叠野减益、堆野者奖励、炼金或点金等修正。
        </p>
        <div className="max-h-52 overflow-auto rounded border border-white/5">
          <table
            className="w-full text-left tabular-nums"
            aria-label="各营地金币与经验收益"
          >
            <thead className="sticky top-0 bg-[#18212a]">
              <tr>
                <th className="p-2">营地 · 点击定位</th>
                <th>金币范围</th>
                <th>经验</th>
                <th>叠野秒数</th>
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
                        {p.label}
                        <span className="ml-2 text-[10px] text-[var(--text-muted)]">
                          {c.name.replace("neutralcamp_", "")}
                        </span>
                      </button>
                    </td>
                    <td className="text-[#e8c781]">
                      {gold ? goldText(gold) : "未收录"}
                    </td>
                    <td className="text-[#a6daf4]">
                      {xpText(
                        campExperience(economy, c, time, includeChildren),
                      )}
                    </td>
                    <td>{c.stack?.join("–") ?? "未提供"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {camp ? (
          <div className="mt-4" aria-label="营地组合详情">
            <h3 className="font-semibold">
              {selected!.label} · {camp.name.replace("neutralcamp_", "")}
            </h3>
            <p className="mt-2 font-mono text-[11px]">
              生成点 X {selected!.x.toFixed(1)} / Y {selected!.y.toFixed(1)} / Z
              轴 {selected!.z?.toFixed(1) ?? "未知"}
            </p>
            {zones.map((z) => (
              <details key={z.id} className="mt-2 rounded bg-white/5 p-2">
                <summary className="cursor-pointer">
                  刷新体积 Z 轴范围：{z.zMin?.toFixed(1) ?? "未知"}～
                  {z.zMax?.toFixed(1) ?? "未知"} · 查看XYZ顶点
                </summary>
                <p className="mt-2 font-mono text-[10px]">
                  {z.worldVertices?.map((v, i) => (
                    <span key={i} className="block">
                      {v.x.toFixed(1)}, {v.y.toFixed(1)}, {v.z.toFixed(1)}
                    </span>
                  )) ?? "此来源只有二维边界"}
                </p>
              </details>
            ))}
            <p className="mt-3">
              叠野：每分钟{" "}
              {camp.stack?.map((n) => `:${n}`).join("–") ?? "未提供"}
              。整分钟前将野怪引出整个刷新体积。
            </p>
            {camp.pulls.length ? (
              camp.pulls.map((p) => (
                <p className="mt-1" key={p.team}>
                  {p.team === "radiant" ? "天辉" : "夜魇"}拉野：
                  {p.windows
                    .map((w) =>
                      w.map((n) => `:${String(n).padStart(2, "0")}`).join("–"),
                    )
                    .join(" / ")}
                </p>
              ))
            ) : (
              <p className="mt-1 text-[var(--text-muted)]">
                该营地的游戏时间表未提供拉兵线时刻。
              </p>
            )}
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              来自本版本游戏提示表；实际成功率受路线、树木、单位移速和叠数影响。方向字段保留在Dataset，未把提示箭头当作可通行路径。
            </p>
            {camp.minType === 7 && (
              <p className="mt-2 text-[#e8c781]">
                洪流营地每5分钟升级一个单位，最多{camp.maxUpgrade}
                轮。以下为未被封野、正常刷新的进化组合；阻挡或未清理可能使实际进度落后。
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
                    <strong>{g.label}</strong>
                    <span className="float-right text-[#e8c781]">
                      {goldText(groupGold(economy, g, time, includeChildren))}{" "}
                      金 ·{" "}
                      <span className="text-[#a6daf4]">
                        {xpText(
                          groupExperience(economy, g, time, includeChildren),
                        )}{" "}
                        经验
                      </span>
                    </span>
                  </summary>
                  <table className="mt-2 w-full text-left tabular-nums">
                    <thead>
                      <tr>
                        <th>单位</th>
                        <th>数量</th>
                        <th>单体金币</th>
                        <th>单体经验</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ...g.members,
                        ...(includeChildren ? g.children : []),
                      ].map((m) => (
                        <tr key={m.unit}>
                          <td className="py-1">
                            {economy.units[m.unit].name}
                            {g.children.some((c) => c.unit === m.unit)
                              ? "（分裂体）"
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
                            {unitExperience(economy, m.unit, time) ?? "未收录"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {g.spawnType === 2 && g.tier === 2 && (
                    <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                      不计黑暗巨魔主动召唤的骷髅，其数量取决于战斗过程。
                    </p>
                  )}
                </details>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[var(--text-muted)]">
            点击地图上的营地或上表，查看刷新体积、拉野时间和全部可能组合。
          </p>
        )}
      </section>
      <section
        className="min-w-0 rounded border border-white/10 bg-[#101820] p-4"
        aria-label="兵线收益计算"
      >
        <h2 className="mb-3 font-semibold">兵线 · 出生时间与兵营状态</h2>
        <div className="flex flex-wrap gap-2">
          <CompactSelect
            hideLabel
            label="兵线阵营"
            className="map-select"
            value={team}
            onValueChange={(value) => setTeam(value as typeof team)}
          >
            <option value="radiant">天辉出兵</option>
            <option value="dire">夜魇出兵</option>
          </CompactSelect>
          <CompactSelect
            hideLabel
            label="兵线路线"
            className="map-select"
            value={lane}
            onValueChange={(value) => setLane(value)}
          >
            <option value="top">上路</option>
            <option value="mid">中路</option>
            <option value="bot">下路</option>
          </CompactSelect>
          <CompactSelect
            hideLabel
            label="兵营状态"
            className="map-select"
            value={state}
            onValueChange={(value) => onState(value as BarracksState)}
          >
            {Object.entries(BARRACKS_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </CompactSelect>
        </div>
        <p className="mt-2 leading-5 text-[var(--text-muted)]">
          兵营状态指所选出兵阵营的敌方兵营；摧毁敌方近战／远程兵营会强化己方对应兵种。本路两座被毁与全部六座被毁是不同状态。
        </p>
        <div className="my-4 flex items-center justify-between gap-2">
          <button
            className={control}
            aria-label="上一波"
            disabled={time === 0}
            onClick={() => onTime(Math.max(0, wave.time - 30))}
          >
            ← 上一波
          </button>
          <strong className="tabular-nums">
            {clockText(wave.time)} · 第{wave.number}波
          </strong>
          <button
            className={control}
            aria-label="下一波"
            disabled={time >= 7200}
            onClick={() => onTime(Math.min(7200, wave.time + 30))}
          >
            下一波 →
          </button>
        </div>
        <div className="mb-3 rounded bg-[#dcc08310] p-3">
          <span className="text-[var(--text-muted)]">
            单人全补刀 · 含旗手额外奖励
          </span>
          <strong
            className="ml-3 text-lg tabular-nums text-[#e8c781]"
            data-wave-gold
          >
            {goldText(wave.total)} 金
          </strong>
          <strong
            className="ml-3 text-lg tabular-nums text-[#a6daf4]"
            data-wave-xp
          >
            {wave.xp ?? "未收录"} 经验
          </strong>
        </div>
        <table className="w-full text-left tabular-nums">
          <thead>
            <tr>
              <th>兵种</th>
              <th>数量</th>
              <th>单体金币</th>
              <th>本波金币</th>
              <th>经验</th>
            </tr>
          </thead>
          <tbody>
            {wave.rows.map((r) => (
              <tr key={r.id} className="border-b border-white/5">
                <td className="py-2">{r.label}</td>
                <td>×{r.count}</td>
                <td>{goldText(r.direct)}</td>
                <td>{goldText(r.total)}</td>
                <td>{r.totalXp ?? "未收录"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3">
          单位悬赏 {goldText(wave.direct)}；旗手额外奖励{" "}
          {goldText(wave.flagBonus)}。
        </p>
        <p className="mt-2 text-[10px] leading-5 text-[var(--text-muted)]">
          经验按范围内单人独享整波计算，不要求补刀；多人会分摊，反补及其他修正未计。旗手额外奖励只增加金币。远程兵每7分30秒增加8经验；中立单位按同版本升级技能每次增加5经验（仅适用于拥有该技能的单位）。
        </p>
        <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
          标准模式，金币区间为规则计算值，未逐项实机结算验证。只计算击杀该波小兵的玩家；不把附近队友获得的旗手奖励累加。时间指小兵出生时刻，不是到达线上或死亡时刻；未计反补、技能、装备和极速模式。
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer">出兵与收益规则</summary>
          <p className="mt-2 leading-6">
            0:00起每30秒一波；15/30/45分钟各增加1近战兵，40分钟增加1远程兵；2:00起整分钟旗手替换1近战兵。5:00起每5分钟出攻城车，30分钟增至2辆，60分钟增至3辆。每7:30普通近战／旗手+1金，普通／强化远程+3金；强化近战及超级兵按其基础悬赏计算。
          </p>
        </details>
        {route && (
          <details className="mt-3">
            <summary className="cursor-pointer">
              兵线路径 · {route.vertices.length}个XYZ路径点
            </summary>
            <p className="mt-2 font-mono text-[10px]">
              {route.vertices.map((p, i) => (
                <span className="block" key={i}>
                  {i === 0 ? "出生点 " : ""}
                  {p.x}, {p.y}, {p.z}
                </span>
              ))}
            </p>
            <p className="mt-2 text-[var(--text-muted)]">
              地图中的虚线连接原生路径点，不代表单位实时轨迹或到线时间。
            </p>
          </details>
        )}
        <details className="mt-4 text-[10px] text-[var(--text-muted)]">
          <summary className="cursor-pointer">版本与数据来源</summary>
          <p className="mt-2">
            {economy.patch} / 客户端{economy.clientVersion}
            。单位悬赏、中文名、拉野表、原生营地及路径取自同一安装；组合数量和时间规则为按补丁审阅的独立模型。
          </p>
          {economy.sources.map((s) => (
            <a
              key={s.url}
              className="mt-1 block underline"
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              {s.label}
            </a>
          ))}
        </details>
      </section>
    </section>
  );
}
