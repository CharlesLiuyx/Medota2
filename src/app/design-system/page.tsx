import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, Database, Swords } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Design System" };

export default function DesignSystemPage() {
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-9 sm:px-7 lg:px-10 lg:py-12">
      <PageHeader
        eyebrow="System · v1"
        title="Medota2 Design System"
        description="Hero Catalog 的语义 token、目录组件、状态和数据表达画廊。此页面是开发基线，不读取产品数据库。"
        aside={
          <DatasetBadge
            clientVersion="6918"
            sourceCommit="991daaf6fc24b08445209d9ce8767e145bab107e"
            warningCount={0}
          />
        }
      />

      <div className="mt-12 grid gap-10">
        <section>
          <SectionHeading eyebrow="Foundation" title="Semantic colors" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Strength", "var(--attribute-strength)"],
              ["Agility", "var(--attribute-agility)"],
              ["Intelligence", "var(--attribute-intelligence)"],
              ["Universal", "var(--attribute-universal)"],
              ["Success", "var(--status-success)"],
              ["Warning", "var(--status-warning)"],
              ["Danger", "var(--status-danger)"],
              ["Accent", "var(--accent-primary)"],
            ].map(([label, color]) => (
              <Panel key={label} className="flex items-center gap-3 p-3">
                <span
                  className="size-8 border border-[var(--border-default)]"
                  style={{ backgroundColor: color }}
                />
                <span className="font-data text-xs text-[var(--text-secondary)]">
                  {label}
                </span>
              </Panel>
            ))}
          </div>
        </section>

        <section>
          <SectionHeading eyebrow="Primitive" title="Badges" />
          <Panel className="mt-4 flex flex-wrap gap-2 p-5">
            <Badge>Neutral</Badge>
            <Badge tone="accent">Current</Badge>
            <Badge tone="strength">力量</Badge>
            <Badge tone="agility">敏捷</Badge>
            <Badge tone="intelligence">智力</Badge>
            <Badge tone="universal">全才</Badge>
            <Badge tone="success">
              <CheckCircle2 className="size-3" /> Green
            </Badge>
            <Badge tone="warning">
              <AlertTriangle className="size-3" /> Yellow
            </Badge>
            <Badge tone="danger">Red</Badge>
          </Panel>
        </section>

        <section>
          <SectionHeading eyebrow="Data display" title="Panels & values" />
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Panel className="p-5">
              <Database className="size-5 text-[var(--accent-hover)]" />
              <p className="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Dataset
              </p>
              <p className="mt-1 font-data text-lg text-[var(--text-primary)]">
                991daaf6
              </p>
            </Panel>
            <Panel className="p-5">
              <Swords className="size-5 text-[var(--attribute-strength)]" />
              <p className="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Ability bindings
              </p>
              <p className="mt-1 font-data text-lg text-[var(--text-primary)]">
                876
              </p>
            </Panel>
            <Panel className="p-5">
              <AlertTriangle className="size-5 text-[var(--status-warning)]" />
              <p className="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                Review state
              </p>
              <p className="mt-1 text-lg text-[var(--text-primary)]">
                Yellow · pending
              </p>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}
