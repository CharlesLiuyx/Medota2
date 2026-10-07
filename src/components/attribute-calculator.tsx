"use client";
import { useState } from "react";
import { useTranslations } from "@/i18n/provider";
import { physicalDamageMultiplier } from "@/domain/attribute-mechanics";
export function AttributeCalculator() {
  const t = useTranslations();
  const [armor, setArmor] = useState("7");
  const value = armor.trim() ? Number(armor) : NaN;
  const valid = Number.isFinite(value) && Math.abs(value) <= 10000;
  const multiplier = valid ? physicalDamageMultiplier(value) : NaN;
  return (
    <div className="mt-4 space-y-2 text-xs">
      <label className="flex items-center gap-3">
        {t("示例总护甲")}
        <input
          aria-label={t("示例总护甲")}
          type="number"
          min={-10000}
          max={10000}
          step="0.1"
          value={armor}
          onChange={(e) => setArmor(e.target.value)}
          className="w-24 bg-white/5 p-2"
        />
      </label>
      <output aria-live="polite">
        {valid
          ? t("每 100 点物理伤害，护甲结算后承受 {value0} 点。", {
              value0: (100 * multiplier).toFixed(2),
            })
          : t("请输入有效护甲数值。")}
      </output>
      <p className="text-[var(--text-muted)]">
        {t("示例只计算护甲环节，公式仍待同版本引擎复核。")}
      </p>
    </div>
  );
}
