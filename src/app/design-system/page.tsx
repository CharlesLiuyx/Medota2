import { getTranslations } from "@/i18n/server";
import type { Metadata } from "next";
import {
  DesignSystemBadgeList,
  DesignSystemColorList,
  DesignSystemMetricList,
} from "@/components/design-system-lists";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("界面示例") };
}
export default async function DesignSystemPage() {
  const t = await getTranslations();
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-9 sm:px-7 lg:px-10 lg:py-12">
      <PageHeader
        eyebrow={t("DOTA 2 · 视觉样式")}
        title={t("Medota2 界面示例")}
        description={t(
          "图鉴的属性颜色、状态标签和数值展示示例。以下为演示内容。",
        )}
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
          <SectionHeading eyebrow={t("基础")} title={t("语义配色")} />
          <DesignSystemColorList />
        </section>

        <section>
          <SectionHeading eyebrow={t("组件")} title={t("标签")} />
          <DesignSystemBadgeList />
        </section>

        <section>
          <SectionHeading eyebrow={t("信息展示")} title={t("面板与数值")} />
          <DesignSystemMetricList />
        </section>
      </div>
    </main>
  );
}
