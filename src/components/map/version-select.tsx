"use client";
import { CompactSelect } from "@/components/ui/compact-select";
import { useRouter } from "next/navigation";

export function MapVersionSelect({
  versions,
  selected,
}: {
  versions: { id: string; patch: string; clientVersion: string | null }[];
  selected: string;
}) {
  const router = useRouter();
  return (
    <CompactSelect
      hideLabel
      label="地图版本"
      value={selected}
      onValueChange={(value) => {
        router.push(`/map?version=${encodeURIComponent(value)}`);
      }}
      className="map-select"
    >
      {versions.map((v) => (
        <option key={v.id} value={v.id}>
          地图 {v.patch} ·{" "}
          {v.clientVersion ? `客户端 ${v.clientVersion}` : "来源快照"}
        </option>
      ))}
    </CompactSelect>
  );
}
