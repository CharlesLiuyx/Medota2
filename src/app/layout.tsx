import type { Metadata } from "next";
import { AppShell, getEnvironmentTitlePrefix } from "@/components/app-shell";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import { getWebDatabase } from "@/server/db/client";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const declaration = getDeclaredPublicEnvironment();
  const prefix = getEnvironmentTitlePrefix(declaration.environment);
  return {
    title: {
      default: `${prefix}Medota2`,
      template: `${prefix}%s · Medota2`,
    },
    description: "可追溯的 Dota 2 Heroes 与 Abilities 目录",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const declaredEnvironment = getDeclaredPublicEnvironment();
  const environment = await getWebDatabase()
    .then(async (database) =>
      toPublicEnvironmentIdentity(await database.verifyIdentity()),
    )
    .catch(() => declaredEnvironment);

  return (
    <html
      lang="zh-CN"
      data-theme="dark"
      data-environment={environment.environment}
      data-data-class={environment.dataClass}
      data-environment-verification={
        environment.verified ? "verified" : "unverified"
      }
      data-environment-run={environment.runId ?? "none"}
    >
      <body>
        <AppShell environment={environment}>{children}</AppShell>
      </body>
    </html>
  );
}
