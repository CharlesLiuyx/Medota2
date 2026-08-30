"use client";

import { AlertTriangle, CheckCircle2, Database, Swords } from "lucide-react";
import { InfiniteList } from "@/components/infinite-list";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

const COLORS = [
  ["Strength", "var(--attribute-strength)"],
  ["Agility", "var(--attribute-agility)"],
  ["Intelligence", "var(--attribute-intelligence)"],
  ["Universal", "var(--attribute-universal)"],
  ["Success", "var(--status-success)"],
  ["Warning", "var(--status-warning)"],
  ["Danger", "var(--status-danger)"],
  ["Accent", "var(--accent-primary)"],
] as const;

const BADGES: Array<{
  label: string;
  tone?: BadgeTone;
  icon?: "check" | "warning";
}> = [
  { label: "Neutral" },
  { label: "Current", tone: "accent" },
  { label: "力量", tone: "strength" },
  { label: "敏捷", tone: "agility" },
  { label: "智力", tone: "intelligence" },
  { label: "全才", tone: "universal" },
  { label: "Green", tone: "success", icon: "check" },
  { label: "Yellow", tone: "warning", icon: "warning" },
  { label: "Red", tone: "danger" },
];

const METRICS = [
  {
    key: "dataset",
    label: "Dataset",
    value: "991daaf6",
    icon: "database" as const,
  },
  {
    key: "bindings",
    label: "Ability bindings",
    value: "876",
    icon: "swords" as const,
  },
  {
    key: "review",
    label: "Review state",
    value: "Yellow · pending",
    icon: "warning" as const,
  },
];

export function DesignSystemColorList() {
  return (
    <InfiniteList
      source={{ kind: "local", items: COLORS, identity: "design:colors:v1" }}
      getKey={([label]) => label}
      ariaLabel="Semantic color examples"
      className="mt-4"
      chunkClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      renderChunk={(items) =>
        items.map(([label, color]) => (
          <div
            key={label}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={label}
            className="h-full"
          >
            <Panel className="flex h-full items-center gap-3 p-3">
              <span
                className="size-8 border border-[var(--border-default)]"
                style={{ backgroundColor: color }}
              />
              <span className="font-data text-xs text-[var(--text-secondary)]">
                {label}
              </span>
            </Panel>
          </div>
        ))
      }
    />
  );
}

export function DesignSystemBadgeList() {
  return (
    <Panel className="mt-4 p-5">
      <InfiniteList
        source={{ kind: "local", items: BADGES, identity: "design:badges:v1" }}
        getKey={(item) => item.label}
        ariaLabel="Badge examples"
        chunkClassName="flex flex-wrap gap-2"
        renderChunk={(items) =>
          items.map((item) => (
            <span
              key={item.label}
              role="listitem"
              data-infinite-list-item=""
              data-infinite-list-key={item.label}
            >
              <Badge tone={item.tone}>
                {item.icon === "check" && <CheckCircle2 className="size-3" />}
                {item.icon === "warning" && (
                  <AlertTriangle className="size-3" />
                )}
                {item.label}
              </Badge>
            </span>
          ))
        }
      />
    </Panel>
  );
}

export function DesignSystemMetricList() {
  return (
    <InfiniteList
      source={{ kind: "local", items: METRICS, identity: "design:metrics:v1" }}
      getKey={(item) => item.key}
      ariaLabel="Data panel examples"
      className="mt-4"
      chunkClassName="grid gap-3 md:grid-cols-3"
      renderChunk={(items) =>
        items.map((item) => (
          <div
            key={item.key}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={item.key}
            className="h-full"
          >
            <Panel className="h-full p-5">
              {item.icon === "database" && (
                <Database className="size-5 text-[var(--accent-hover)]" />
              )}
              {item.icon === "swords" && (
                <Swords className="size-5 text-[var(--attribute-strength)]" />
              )}
              {item.icon === "warning" && (
                <AlertTriangle className="size-5 text-[var(--status-warning)]" />
              )}
              <p className="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {item.label}
              </p>
              <p
                className={`mt-1 text-lg text-[var(--text-primary)] ${item.key === "review" ? "" : "font-data"}`}
              >
                {item.value}
              </p>
            </Panel>
          </div>
        ))
      }
    />
  );
}
