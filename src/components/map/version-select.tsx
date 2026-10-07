"use client";
import { Message, useTranslations } from "@/i18n/provider";

import { CompactSelect } from "@/components/ui/compact-select";
import { useRouter } from "next/navigation";
export function MapVersionSelect({
  versions,
  selected,
}: {
  versions: {
    id: string;
    patch: string;
    clientVersion: string | null;
  }[];
  selected: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  return (
    <CompactSelect
      hideLabel
      label={t("地图版本")}
      value={selected}
      onValueChange={(value) => {
        router.push(`/map?version=${encodeURIComponent(value)}`);
      }}
      className="map-select"
    >
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          <Message
            id="地图 {value0} · {value1}"
            values={{
              value0: v.patch,
              value1: v.clientVersion
                ? t("客户端 {value0}", {
                    value0: v.clientVersion,
                  })
                : t("来源快照"),
            }}
          />
        </option>
      ))}
    </CompactSelect>
  );
}
