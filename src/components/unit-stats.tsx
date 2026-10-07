"use client";
import { useTranslations } from "@/i18n/provider";
import { AttributeLink } from "./attribute-link";
import { UNIT_STATS, type UnitDefinition } from "@/domain/units";
export function UnitStats({
  unit,
  compact = false,
}: {
  unit: UnitDefinition;
  compact?: boolean;
}) {
  const t = useTranslations();
  const keys = compact
    ? ["StatusHealth", "AttackDamageMin", "ArmorPhysical", "MovementSpeed"]
    : Object.keys(UNIT_STATS);
  return (
    <dl
      className={`grid gap-x-5 gap-y-2 text-xs ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"}`}
    >
      {keys.map((key) => (
        <div key={key}>
          <dt className="text-[var(--text-muted)]">
            <AttributeLink kind="unit" owner={unit.internalName} field={key}>
              {t(UNIT_STATS[key as keyof typeof UNIT_STATS])}
            </AttributeLink>
          </dt>
          <dd className="mt-1 font-data text-[var(--text-primary)]">
            {unit.stats[key] ?? t("待确认")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
