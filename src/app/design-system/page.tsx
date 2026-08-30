import type { Metadata } from "next";
import {
  DesignSystemBadgeList,
  DesignSystemColorList,
  DesignSystemMetricList,
} from "@/components/design-system-lists";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";

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
            gateStatus="green"
          />
        }
      />

      <div className="mt-12 grid gap-10">
        <section>
          <SectionHeading eyebrow="Foundation" title="Semantic colors" />
          <DesignSystemColorList />
        </section>

        <section>
          <SectionHeading eyebrow="Primitive" title="Badges" />
          <DesignSystemBadgeList />
        </section>

        <section>
          <SectionHeading eyebrow="Data display" title="Panels & values" />
          <DesignSystemMetricList />
        </section>
      </div>
    </main>
  );
}
