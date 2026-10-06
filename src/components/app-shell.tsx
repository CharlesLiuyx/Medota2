import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import type {
  PublicEnvironmentIdentity,
  RuntimeEnvironment,
} from "@/domain/environment";
import { EntityTabs } from "./ui/entity-tabs";
const ENVIRONMENT_NOTICES = {
  development: ["开发预览", "演示数据"],
  test: ["测试预览", "测试样例数据"],
  "local-review": ["本地预览", "游戏版本资料"],
  production: ["正式环境", "在线数据"],
} satisfies Record<RuntimeEnvironment, string[]>;
export function AppShell({
  children,
  environment,
  mapOnly = false,
}: {
  children: ReactNode;
  environment: PublicEnvironmentIdentity;
  mapOnly?: boolean;
}) {
  return (
    <>
      <header className="sticky top-0 z-40 bg-[#0d141bef] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[var(--content-max)] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex h-7 items-stretch gap-2 sm:gap-5">
            <Link
              href={mapOnly ? "/map" : "/heroes"}
              className="flex shrink-0 items-center gap-1.5"
              aria-label={mapOnly ? "Medota2 地图" : "Medota2 英雄图鉴"}
            >
              <Image
                src="/brand/medota2-rook-knight.png"
                alt=""
                width={22}
                height={22}
                priority
                className="size-[22px] object-contain"
              />
              <strong className="text-xs font-semibold tracking-wide">
                Medota2
              </strong>
            </Link>
            {mapOnly ? (
              <Link href="/map" className="flex items-center text-xs">
                地图
              </Link>
            ) : (
              <EntityTabs />
            )}
          </div>
          <div className="flex h-7 min-w-0 items-center justify-end gap-3">
            <div id="map-header-status" className="flex items-center" />
            {mapOnly ? (
              <aside className="text-[10px] text-[var(--text-muted)]">
                本地地图 · 按版本读取
              </aside>
            ) : (
              <EnvironmentStrip environment={environment} />
            )}
          </div>
        </div>
      </header>
      {children}
      <footer className="mx-auto mt-6 flex max-w-[var(--content-max)] flex-col gap-2 px-4 py-4 text-xs leading-6 text-[var(--text-muted)] sm:flex-row sm:justify-between">
        <p>非官方 Dota 2 游戏资料图鉴 · 数值以收录版本为准</p>
        <p>Valve、Dota 2 及相关商标归其权利人所有。</p>
      </footer>
    </>
  );
}
export function EnvironmentStrip({
  environment,
}: {
  environment: PublicEnvironmentIdentity;
}) {
  const [heading, data] = ENVIRONMENT_NOTICES[environment.environment];
  return (
    <aside
      role="status"
      aria-label="Runtime environment"
      data-environment-indicator="true"
      data-environment={environment.environment}
      data-data-class={environment.dataClass}
      data-verification={environment.verified ? "verified" : "unverified"}
      data-run={environment.runId ?? "none"}
      className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]"
    >
      <span>{heading}</span>
      <span className="hidden sm:inline">·</span>
      <span className={environment.verified ? "hidden sm:inline" : ""}>
        {environment.verified ? data : "数据连接未验证，暂不可用"}
      </span>
    </aside>
  );
}
export function getEnvironmentTitlePrefix(
  environment: RuntimeEnvironment,
): string {
  return environment === "development"
    ? ""
    : `[${ENVIRONMENT_NOTICES[environment][0]}] `;
}
