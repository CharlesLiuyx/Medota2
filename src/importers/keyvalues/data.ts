import type { KeyValuesObject } from "./parser";

// Lines and order between unique KV keys are source layout, not game values.
// Repeated keys retain their occurrence order and are never collapsed.
export function keyValuesData(
  object: KeyValuesObject,
): Record<string, unknown> {
  const grouped = new Map<string, unknown[]>();
  for (const entry of object.entries) {
    const values = grouped.get(entry.key) ?? [];
    values.push(
      typeof entry.value === "string"
        ? entry.value
        : keyValuesData(entry.value),
    );
    grouped.set(entry.key, values);
  }
  return Object.fromEntries(
    [...grouped].map(([key, values]) => [
      key,
      values.length === 1 ? values[0] : { occurrences: values },
    ]),
  );
}

export function withoutSourceLayout(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSourceLayout);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.entries))
    return keyValuesData(record as unknown as KeyValuesObject);
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "line")
      .map(([key, child]) => [key, withoutSourceLayout(child)]),
  );
}
