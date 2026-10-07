import { formatAttributeEnum } from "@/domain/attribute-enums";
import Link from "./version-link";
import { getAttributeOverview } from "@/server/repositories/attributes";
import { getRequestGameLocale, getTranslations } from "@/i18n/server";
import type { AttributeOwnerKind } from "@/domain/attributes";
export async function OwnerAttributeList({
  kind,
  owner,
  dataset,
}: {
  kind: AttributeOwnerKind;
  owner: string;
  dataset?: string;
}) {
  const [{ snapshot }, locale, t] = await Promise.all([
    getAttributeOverview(dataset),
    getRequestGameLocale(),
    getTranslations(),
  ]);
  const references =
    snapshot?.entries.flatMap((entry) =>
      entry.relations
        .filter((r) => r.kind === kind && r.owner === owner)
        .map((relation) => ({ entry, relation })),
    ) ?? [];
  if (!references.length) return null;
  return (
    <details className="mt-5 bg-[#182127]/65 p-4 text-xs">
      <summary className="cursor-pointer font-semibold">
        {t("完整属性引用")} · {references.length}
      </summary>
      <p className="my-3 text-[var(--text-muted)]">
        {t("查看该对象全部已收录数值与属性")}
      </p>
      <dl className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
        {references.map(({ entry, relation }) => (
          <div
            key={`${entry.id}:${relation.field}`}
            className="flex justify-between gap-3 py-2"
          >
            <dt className="min-w-0">
              <Link
                prefetch={false}
                className="break-words text-[#c4a16a]"
                href={`/attributes/${encodeURIComponent(entry.id)}`}
              >
                {locale === "en" ? entry.en : entry.zh}
              </Link>
              <span className="block break-all text-[var(--text-muted)]">
                {relation.field}
              </span>
            </dt>
            <dd className="min-w-0 max-w-[60%] text-right font-data [overflow-wrap:anywhere]">
              {t(formatAttributeEnum(relation.value, entry.enumValues, locale))}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
