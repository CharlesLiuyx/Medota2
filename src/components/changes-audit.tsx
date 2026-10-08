"use client";
import { InfiniteList } from "./infinite-list";
import type {
  EntityVersionDiff,
  EntityVersionChange,
} from "@/domain/entity-version-diff";
import { useTranslations } from "@/i18n/provider";
/** Diagnostics use the same continuous collection behavior as the player-facing tables. */
export function ChangesAudit({
  technical,
  unresolved,
}: {
  technical: EntityVersionChange[];
  unresolved: EntityVersionDiff["unresolved"];
}) {
  const t = useTranslations();
  const records = [
    ...unresolved.map((value, index) => ({
      key: `unresolved:${index}`,
      title: `${value.entityKey} · ${value.reason}`,
      value,
    })),
    ...technical.map((value, index) => ({
      key: `technical:${index}`,
      title: `${value.entityKey} · ${value.path}`,
      value,
    })),
  ];
  return (
    <details className="mt-2">
      <summary>
        {t("原始资料及尚未解释的变化（{value0}）", { value0: records.length })}
      </summary>
      <InfiniteList
        source={{ kind: "local", items: records, chunkSize: 20 }}
        getKey={(record) => record.key}
        showComplete={false}
        renderChunk={(items) =>
          items.map((item) => (
            <details key={item.key} className="mt-2 text-[10px] break-all">
              <summary>{item.title}</summary>
              <pre className="whitespace-pre-wrap break-all">
                {JSON.stringify(item.value, null, 2)}
              </pre>
            </details>
          ))
        }
      />
    </details>
  );
}
