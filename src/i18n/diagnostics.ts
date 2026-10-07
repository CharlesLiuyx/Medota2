import type { Locale } from "./locale";
import { createTranslator, messageTemplate } from "./messages";
/** Decode known legacy diagnostic formats at the presentation boundary. Raw logs stay raw. */
export function diagnosticText(locale: Locale, message: string): string {
  const t = createTranslator(locale);
  if (messageTemplate(locale, message) !== message) return t(message);
  if (message.includes("。；"))
    return message
      .split("。；")
      .map((part, index, parts) =>
        diagnosticText(locale, index < parts.length - 1 ? `${part}。` : part),
      )
      .join(t("；"));
  for (const separator of ["；", " · ", "："]) {
    if (message.includes(separator))
      return message
        .split(separator)
        .map((part) => diagnosticText(locale, part))
        .join(t(separator));
  }
  const patterns: [RegExp, string, string[]][] = [
    [/^(.+) 只允许一个值。$/u, "{field} 只允许一个值。", ["field"]],
    [/^(.+) 标识符无效$/u, "{field} 标识符无效", ["field"]],
    [/^(.+) 无效$/u, "{field} 无效", ["field"]],
    [/^未知(.+)$/u, "未知{field}", ["field"]],
    [
      /^(.+) 已变化，运行 pnpm dev:restart 载入配置$/u,
      "{file} 已变化，运行 pnpm dev:restart 载入配置",
      ["file"],
    ],
    [
      /^Web 服务已退出（(.+)）；查看开发日志后重新运行 pnpm dev。$/u,
      "Web 服务已退出（{code}）；查看开发日志后重新运行 pnpm dev。",
      ["code"],
    ],
    [
      /^计算进程退出（(.+)），修复后保存会自动重跑。$/u,
      "计算进程退出（{code}），修复后保存会自动重跑。",
      ["code"],
    ],
  ];
  for (const [pattern, id, keys] of patterns) {
    const match = pattern.exec(message);
    if (match)
      return t(
        id,
        Object.fromEntries(keys.map((key, i) => [key, t(match[i + 1])])),
      );
  }
  return t(message);
}
