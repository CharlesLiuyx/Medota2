"use client";
import { useState } from "react";
import { InfiniteList } from "./infinite-list";
import { DeferredResource } from "./deferred-resource";
import type {
  EntityVersionDiff,
  EntityVersionChange,
} from "@/domain/entity-version-diff";
import { useTranslations } from "@/i18n/provider";
interface AuditData {
  technical: EntityVersionChange[];
  unresolved: EntityVersionDiff["unresolved"];
}
export function ChangesAudit(
  props: AuditData | { resource: string; count: number },
) {
  const t = useTranslations();
  const [opened, setOpened] = useState(false);
  const count =
    "resource" in props
      ? props.count
      : props.technical.length + props.unresolved.length;
  return (
    <details
      className="mt-2"
      onToggle={(event) => setOpened(event.currentTarget.open)}
    >
      <summary>
        {t("原始资料及尚未解释的变化（{value0}）", { value0: count })}
      </summary>
      {opened &&
        ("resource" in props ? (
          <DeferredResource<AuditData> url={props.resource}>
            {(data) => <AuditRecords {...data} />}
          </DeferredResource>
        ) : (
          <AuditRecords {...props} />
        ))}
    </details>
  );
}
function AuditRecords({ technical, unresolved }: AuditData) {
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
  );
}
