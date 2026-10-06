import { UnitPortrait } from "@/components/unit-portrait";
import { AbilityIcon } from "@/components/ability-icon";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UNIT_CATEGORIES } from "@/domain/units";
import { UnitStats } from "@/components/unit-stats";
import {
  getUnitOverview,
  getUnitAbilities,
  getUnitPortraits,
} from "@/server/repositories/units";
export const metadata: Metadata = { title: "单位详情" };
export const dynamic = "force-dynamic";
export default async function UnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ "internal-name": string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ "internal-name": id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const { meta, snapshot } = await getUnitOverview();
  if (!snapshot || !meta)
    return (
      <main className="mx-auto max-w-[var(--content-max)] px-4 py-12">
        <h1 className="text-xl">单位资料暂不可用</h1>
        <Link href="/units" className="mt-4 block text-sm">
          返回单位图鉴
        </Link>
      </main>
    );
  const unit = snapshot.units.find((value) => value.internalName === id);
  if (!unit) notFound();
  const portraits = await getUnitPortraits(meta.datasetVersionId);
  const en = query.lang === "en";
  const abilities = await getUnitAbilities(meta, unit.abilities);
  return (
    <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] space-y-5 px-4 py-4 sm:px-6">
      <Link
        href={`/units${en ? "?lang=en" : ""}`}
        className="text-xs text-[var(--text-muted)]"
      >
        ← 单位图鉴
      </Link>
      <header className="flex items-center gap-3">
        <UnitPortrait
          unitKey={unit.internalName}
          name={en ? unit.enName : unit.zhName}
          portrait={portraits[unit.internalName]}
          large
        />
        <div>
          <h1 className="text-xl font-semibold">
            {en ? unit.enName : unit.zhName}
          </h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {en ? unit.zhName : unit.enName}
          </p>
          <p className="mt-2 text-xs text-[#c4a16a]">
            {[
              UNIT_CATEGORIES[unit.category],
              unit.team,
              unit.attack,
              unit.variant,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>
      <section className="bg-[#182127]/65 p-4">
        <h2 className="mb-4 text-sm font-semibold">基础属性</h2>
        <UnitStats unit={unit} />
        <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-muted)]">
          数值来自收录版本的单位基础定义，包含公共默认值；对局时间、难度、召唤技能等级与其他效果可能改变实际属性。未解析的值标为待确认。
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">单位技能</h2>
        {abilities.length ? (
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
            {abilities.map((ability, index) => (
              <li
                key={`${ability.internalName}:${index}`}
                className="bg-[#182127]/65 p-3 text-xs"
              >
                {ability.available && (ability.zhName || ability.enName) ? (
                  <Link
                    href={`/abilities/${ability.internalName}${en ? "?lang=en" : ""}`}
                    className="flex items-center gap-2 hover:text-[#c4a16a]"
                  >
                    <AbilityIcon
                      internalName={ability.internalName}
                      name={ability.zhName || ability.enName || "技能"}
                      assetVersion={meta.assetDatasetVersionId}
                      compact
                    />
                    {(en ? ability.enName : ability.zhName) ||
                      ability.zhName ||
                      ability.enName}
                  </Link>
                ) : (
                  <span className="text-[var(--text-muted)]">
                    技能资料待补充
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            此定义没有配置可展示的技能。
          </p>
        )}
      </section>
    </main>
  );
}
