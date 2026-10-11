import "server-only";
import { pinyin } from "pinyin-pro";
import { itemCatalogRow, type ItemDefinition } from "@/domain/items";
import type { UnitDefinition } from "@/domain/units";

const unitRows = new WeakMap<
  readonly UnitDefinition[],
  Array<UnitDefinition & { searchText: string }>
>();
const itemRows = new WeakMap<
  readonly ItemDefinition[],
  Array<ReturnType<typeof itemCatalogRow> & { searchText: string }>
>();
function searchText(item: {
  internalName: string;
  zhName: string;
  enName: string;
}) {
  const syllables = pinyin(item.zhName, {
    toneType: "none",
    type: "array",
    v: true,
  });
  return [
    item.internalName,
    item.zhName,
    item.enName,
    syllables.join(""),
    syllables.map((s) => s[0]).join(""),
  ]
    .join("|")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");
}
/** Source adapters already pin and validate the source. Pure derived rows share its lifetime. */
export function unitCatalogRows(units: readonly UnitDefinition[]) {
  let rows = unitRows.get(units);
  if (!rows) {
    rows = units.map((unit) => ({ ...unit, searchText: searchText(unit) }));
    unitRows.set(units, rows);
  }
  return rows;
}
export function itemCatalogRows(items: readonly ItemDefinition[]) {
  let rows = itemRows.get(items);
  if (!rows) {
    rows = items.map((item) => ({
      ...itemCatalogRow(item),
      searchText: searchText(item),
    }));
    itemRows.set(items, rows);
  }
  return rows;
}
