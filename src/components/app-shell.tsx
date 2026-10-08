"use client";
import { gameLocale } from "@/i18n/config";
import {
  useLocale,
  SourceLanguageNotice,
  useTranslations,
} from "@/i18n/provider";
import { ENVIRONMENT_NOTICES } from "@/i18n/environment";
export { getEnvironmentTitlePrefix } from "@/i18n/environment";
import { LanguageSwitcher, LocalizedText } from "@/i18n/provider";
import Link from "./version-link";
import { ReleaseSwitcher } from "./release-navigation";
import type { ReleaseIndex } from "@/domain/releases";
import Image from "next/image";
import type { ReactNode } from "react";
import type { PublicEnvironmentIdentity } from "@/domain/environment";
import { EntityTabs } from "./ui/entity-tabs";
export function AppShell({
  children,
  environment,
  mapOnly = false,
  releaseIndex = { defaultRelease: null, releases: [] },
}: {
  children: ReactNode;
  environment: PublicEnvironmentIdentity;
  mapOnly?: boolean;
  releaseIndex?: ReleaseIndex;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <>
      <header className="sticky top-0 z-40 bg-[#0d141bef] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[var(--content-max)] items-center justify-between gap-1 px-2 sm:gap-3 sm:px-6">
          <div className="flex h-7 min-w-0 items-stretch gap-2 sm:gap-5">
            <Link
              href={mapOnly ? "/map" : "/heroes"}
              className="flex shrink-0 items-center gap-1.5"
              aria-label={mapOnly ? t("Medota2 地图") : t("Medota2 英雄图鉴")}
            >
              <Image
                src="/brand/medota2-flowing-m.png"
                alt=""
                width={20}
                height={20}
                priority
                className="size-5 shrink-0 object-contain"
              />
              <strong className="hidden text-xs font-semibold tracking-wide sm:inline">
                Medota2
              </strong>
            </Link>
            {mapOnly ? (
              <Link href="/map" className="flex items-center text-xs">
                <LocalizedText>地图</LocalizedText>
              </Link>
            ) : (
              <EntityTabs />
            )}
          </div>
          <div className="flex h-7 shrink-0 items-center justify-end gap-1 sm:gap-3">
            <LanguageSwitcher />
            <ReleaseSwitcher index={releaseIndex} />
            <div id="map-header-status" className="flex items-center" />
            {mapOnly ? (
              <aside className="text-[10px] text-[var(--text-muted)]">
                <LocalizedText>本地地图 · 按版本读取</LocalizedText>
              </aside>
            ) : (
              <div className="hidden lg:block">
                <EnvironmentStrip environment={environment} />
              </div>
            )}
          </div>
        </div>
      </header>
      {!mapOnly && (
        <div className="bg-[#0d141b] px-4 py-1 lg:hidden">
          <EnvironmentStrip environment={environment} />
        </div>
      )}
      {gameLocale(locale) !== locale && (
        <div className="px-4 pt-1">
          <SourceLanguageNotice sourceLocale={gameLocale(locale)} />
        </div>
      )}
      {children}
      <footer className="mx-auto mt-6 flex max-w-[var(--content-max)] flex-col gap-2 px-4 py-4 text-xs leading-6 text-[var(--text-muted)] sm:flex-row sm:justify-between">
        <p>
          <LocalizedText>
            非官方 Dota 2 游戏资料图鉴 · 数值以收录版本为准
          </LocalizedText>
        </p>
        <p>
          <LocalizedText>
            Valve、Dota 2 及相关商标归其权利人所有。
          </LocalizedText>
        </p>
      </footer>
    </>
  );
}
export function EnvironmentStrip({
  environment,
}: {
  environment: PublicEnvironmentIdentity;
}) {
  const t = useTranslations();
  const [heading, data] = ENVIRONMENT_NOTICES[environment.environment];
  return (
    <aside
      role="status"
      aria-label={t("运行环境")}
      data-environment-indicator="true"
      data-environment={environment.environment}
      data-data-class={environment.dataClass}
      data-verification={environment.verified ? "verified" : "unverified"}
      data-run={environment.runId ?? "none"}
      className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]"
    >
      <span>
        <LocalizedText>{heading}</LocalizedText>
      </span>
      <span className="hidden sm:inline">·</span>
      <span className={environment.verified ? "hidden sm:inline" : ""}>
        <LocalizedText>
          {environment.verified ? data : "数据连接未验证，暂不可用"}
        </LocalizedText>
      </span>
    </aside>
  );
}
