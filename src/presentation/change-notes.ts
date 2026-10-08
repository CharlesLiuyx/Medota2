import type { PatchNote } from "@/server/services/release-changes";
import type { ReadableChange } from "./entity-changes";
import { numericLevels } from "./change-impact";
/** Parsing is intentionally limited to explicit endpoint notation; no prose arithmetic or inferred old values. */
export function noteEndpoints(note: PatchNote) {
  const match =
    /^(.+?)[:：]\s*([^→]+)\s*→\s*([^。]+)(?:。.*)?$/u.exec(note.text) ??
    /^(.+?)\s+(?:increased|decreased|reduced|changed) from\s+(.+?)\s+to\s+(.+?)(?:\. |$)/iu.exec(
      note.text,
    );
  if (!match) return null;
  const clean = (text: string) =>
    text.trim().replace(/(?:秒|点|金|s| gold)(?=\s*(?:\/|$))/giu, "");
  const before = clean(match[2]),
    after = clean(match[3]);
  if (!numericLevels(before) || !numericLevels(after)) return null;
  return { label: match[1], before, after };
}
const normalized = (text: string) =>
  text.replace(/[\s的：:，,。.%％（）()]/gu, "").toLowerCase();
function sameLevels(a: string, b: string) {
  const x = numericLevels(a),
    y = numericLevels(b);
  return x && y && x.length === y.length && x.every((v, i) => v === y[i]);
}
/** A compact presentation match only: it does not certify official notes as evidence for individual fields. */
export function noteCovered(note: PatchNote, rows: ReadableChange[]) {
  const textPair = /^.+?[:：]\s*([^→]+)\s*→\s*(.+)$/u.exec(note.text);
  if (
    textPair &&
    rows.some(
      (row) =>
        normalized(textPair[1]) === normalized(row.before) &&
        normalized(textPair[2]) === normalized(row.after),
    )
  )
    return true;
  const endpoint = noteEndpoints(note);
  if (endpoint) {
    const matches = rows.filter(
      (row) =>
        sameLevels(endpoint.before, row.impactBasis?.before ?? row.before) &&
        sameLevels(endpoint.after, row.impactBasis?.after ?? row.after),
    );
    if (matches.length === 1) return true;
  }
  return rows.some((row) =>
    normalized(note.text).startsWith(normalized(row.label)),
  );
}
/** Field inference is scoped to explicit terminology, with the original sentence retained as the source. */
export function noteField(label: string) {
  const fields: Array<[RegExp, string]> = [
    [/基础充能时间|base charge restore time/iu, "AbilityChargeRestoreTime"],
    [/击退持续时间|push duration/iu, "push_duration"],
    [/最低伤害格挡|minimum damage block/iu, "damage_block_threshold"],
    [/隐身粘滞时间|invisibility linger/iu, "grace_time"],
    [/对非英雄单位的吸血|lifesteal.*(?:non-hero|creep)/iu, "lifesteal_creep"],
    [
      /远程幻象.*攻击力|ranged illusion.*damage/iu,
      "images_do_damage_percent_ranged",
    ],
  ];
  return fields.find(([pattern]) => pattern.test(label))?.[1];
}
