import type { RuntimeEnvironment } from "@/domain/environment";
import { DEFAULT_LOCALE, type Locale } from "./locale";
import { translate } from "./messages";
export const ENVIRONMENT_NOTICES = {
  development: ["开发预览", "演示数据"],
  test: ["测试预览", "测试样例数据"],
  "local-review": ["本地预览", "游戏版本资料"],
  production: ["正式环境", "在线数据"],
} satisfies Record<RuntimeEnvironment, string[]>;
export function getEnvironmentTitlePrefix(
  environment: RuntimeEnvironment,
  locale: Locale = DEFAULT_LOCALE,
): string {
  return environment === "development"
    ? ""
    : `[${translate(locale, ENVIRONMENT_NOTICES[environment][0])}] `;
}
