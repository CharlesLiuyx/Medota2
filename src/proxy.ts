import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from "@/i18n/locale";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(
    LOCALE_HEADER,
    resolveLocale(
      request.nextUrl.searchParams.get("lang"),
      request.cookies.get(LOCALE_COOKIE)?.value,
    ),
  );
  return NextResponse.next({ request: { headers } });
}
export const config = {
  matcher: [
    "/((?!api/|_next/|valve-assets/|map/assets/|favicon.ico|icon.svg|apple-icon.png).*)",
  ],
};
