import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Medota2", template: "%s · Medota2" },
  description: "可追溯的 Dota 2 Heroes 与 Abilities 目录",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="dark">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
