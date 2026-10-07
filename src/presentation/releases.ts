import type { ReleaseOption } from "@/domain/releases";
import { createTranslator } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";

export function releaseLabel(release: ReleaseOption, locale: Locale): string {
  const t = createTranslator(locale);
  const client = release.catalogClient ?? release.mapClient;
  return [release.patch ?? t("补丁未知"), client].filter(Boolean).join(" · ");
}
