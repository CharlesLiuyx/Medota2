/** The same expression computes the number and describes it in the UI. */
export type StatExpression = {
  value: number | null;
  key?: string;
  label?: string;
  operator?: "+" | "−" | "×" | "÷" | "round" | "clamp";
  inputs?: StatExpression[];
};
export const literal = (
  value: number | null,
  key?: string,
  label?: string,
): StatExpression => ({ value, key, label });
export function operation(
  operator: NonNullable<StatExpression["operator"]>,
  ...inputs: StatExpression[]
): StatExpression {
  const values = inputs.map((input) => input.value);
  let value: number | null = null;
  if (values.every((n): n is number => n !== null)) {
    switch (operator) {
      case "+":
        value = values.reduce((a, b) => a + b, 0);
        break;
      case "−":
        value = values[0] - values[1];
        break;
      case "×":
        value = values.reduce((a, b) => a * b, 1);
        break;
      case "÷":
        value = values[0] / values[1];
        break;
      case "round":
        value = Number(values[0].toFixed(6));
        break;
      case "clamp":
        value = Math.max(values[1], Math.min(values[2], values[0]));
        break;
    }
  }
  return {
    operator,
    inputs,
    value: value !== null && Number.isFinite(value) ? value : null,
  };
}
export const reference = (
  key: string,
  expression: StatExpression,
): StatExpression => ({ ...expression, key });
export function expressionDependencies(expression: StatExpression): string[] {
  return [
    ...new Set([
      ...(expression.key ? [expression.key] : []),
      ...(expression.inputs ?? []).flatMap(expressionDependencies),
    ]),
  ];
}
export function expressionText(
  expression: StatExpression,
  label: (key: string) => string,
  substituted = false,
  root = true,
): string {
  if (expression.key && !root)
    return substituted
      ? String(expression.value ?? "—")
      : label(expression.key);
  if (!expression.operator)
    return !substituted && expression.label
      ? label(expression.label)
      : String(expression.value ?? "—");
  const parts = expression.inputs!.map((input) =>
    expressionText(input, label, substituted, false),
  );
  if (expression.operator === "round") return parts[0];
  if (expression.operator === "clamp")
    return `${label("限定范围")}(${parts.join(", ")})`;
  return `(${parts.join(` ${expression.operator} `)})`;
}
