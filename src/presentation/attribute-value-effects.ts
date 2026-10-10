/** Known, version-reviewed primary-attribute contributions; never treat a bonus as the final panel. */
export function attributeValueEffects(
  id: string,
  raw: string | undefined,
  reviewed: boolean,
) {
  if (!reviewed || !raw || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(raw.trim()))
    return [];
  const value = Number(raw);
  if (!Number.isFinite(value)) return [];
  const rates: Record<string, Array<[string, number, string]>> = {
    strength: [
      ["生命上限", 22, "点"],
      ["生命恢复", 0.1, "点/秒"],
    ],
    agility: [
      ["护甲", 0.16, "点"],
      ["攻击速度", 1, "点"],
    ],
    intelligence: [
      ["魔法上限", 12, "点"],
      ["魔法恢复", 0.05, "点/秒"],
      ["基础魔法抗性", 0.1, "百分点"],
    ],
  };
  return (rates[id] ?? []).map(([label, rate, unit]) => ({
    label,
    unit,
    expression: `${value} × ${rate} = ${Number((value * rate).toFixed(10))}`,
  }));
}
