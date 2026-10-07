import { gameLocale } from "./config";
import { createTranslator } from "./messages";
import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from "./locale";

export async function getRequestLocale() {
  return resolveLocale(
    (await headers()).get(LOCALE_HEADER),
    (await cookies()).get(LOCALE_COOKIE)?.value,
  );
}

export async function getTranslations() {
  return createTranslator(await getRequestLocale());
}

export async function getRequestGameLocale() {
  return gameLocale(await getRequestLocale());
}
