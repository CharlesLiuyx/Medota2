import { localeDefinitions } from "@/i18n/config";
import { LocaleProvider } from "@/i18n/provider";
import { getRequestLocale } from "@/i18n/server";
import { getReleaseIndex } from "@/server/services/releases";
import { ReleaseNavigation } from "@/components/release-navigation";
import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { getEnvironmentTitlePrefix } from "@/i18n/environment";
import { getTranslations } from "@/i18n/server";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import { getWebDatabase } from "@/server/db/client";
import { DevelopmentWorkbench } from "@/components/development-workbench";
import { loadLocalEnv } from "@/config/env";
import "./globals.css";

export const dynamic = "force-dynamic";

function presentationEnvironment() {
  loadLocalEnv();
  if (process.env.MEDOTA2_WORKBENCH_MAPS_ONLY === "1") {
    if (
      process.env.MEDOTA2_ENVIRONMENT !== "development" ||
      process.env.MEDOTA2_DATA_CLASS !== "sandbox"
    )
      throw new Error("Map-only preview requires development + sandbox");
    // A filesystem map preview has no database identity. Database API admission
    // still goes through getWebDatabase and its unchanged receipt checks.
    return {
      environment: "development" as const,
      dataClass: "sandbox" as const,
      databaseName: null,
      runId: null,
      safeFingerprint: null,
      verified: false as const,
    };
  }
  return getDeclaredPublicEnvironment();
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = await getTranslations();
  const declaration = presentationEnvironment();
  const prefix = getEnvironmentTitlePrefix(declaration.environment, locale);
  return {
    title: {
      default: `${prefix}Medota2`,
      template: `${prefix}%s · Medota2`,
    },
    description: t("可追溯的 Dota 2 Heroes 与 Abilities 目录"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  const declaredEnvironment = presentationEnvironment();
  const mapOnly = process.env.MEDOTA2_WORKBENCH_MAPS_ONLY === "1";
  const environment = mapOnly
    ? declaredEnvironment
    : await getWebDatabase()
        .then(async (database) =>
          toPublicEnvironmentIdentity(await database.verifyIdentity()),
        )
        .catch(() => declaredEnvironment);

  const releaseIndex =
    environment.verified || mapOnly
      ? await getReleaseIndex()
      : { defaultRelease: null, releases: [] };
  return (
    <html
      lang={locale}
      dir={localeDefinitions[locale].direction}
      data-theme="dark"
      data-environment={environment.environment}
      data-data-class={environment.dataClass}
      data-environment-verification={
        environment.verified ? "verified" : "unverified"
      }
      data-environment-run={environment.runId ?? "none"}
    >
      <body>
        <LocaleProvider initialLocale={locale}>
          <ReleaseNavigation index={releaseIndex}>
            <AppShell
              environment={environment}
              mapOnly={mapOnly}
              releaseIndex={releaseIndex}
            >
              {children}
            </AppShell>
          </ReleaseNavigation>
          {process.env.NODE_ENV === "development" &&
            process.env.MEDOTA2_WORKBENCH === "1" &&
            !mapOnly && <DevelopmentWorkbench />}
        </LocaleProvider>
      </body>
    </html>
  );
}
