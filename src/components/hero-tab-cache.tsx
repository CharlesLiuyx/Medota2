"use client";

import {
  createContext,
  useLayoutEffect,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { useLocale } from "@/i18n/provider";
import { gameLocale } from "@/i18n/config";
import { withLocale } from "@/i18n/locale";
import { withRelease } from "@/domain/releases";
import { browserScope } from "@/browser/resources";
import { peekBrowserReplica } from "@/browser/catalog-replica";
import { queryReplica } from "@/domain/catalog-replica";
import { CATALOG_PRESENTATION_KEYS } from "@/presentation/catalog-view";
import {
  parseHeroFilters,
  type SearchParams,
} from "@/server/services/hero-filters";
import { useRelease } from "./release-navigation";
import { LiveHeroCatalog } from "./live-catalog";

type HeroPageProps = ComponentProps<typeof LiveHeroCatalog>;
type Snapshot = {
  contextKey: string;
  props: HeroPageProps;
  scope: string;
  expires: number;
};
type ActivePage = {
  contextKey: string;
  props: HeroPageProps;
  entry: number;
  title: string;
};
const HeroTabContext = createContext<{
  register: (props: HeroPageProps) => void;
  navigate: () => boolean;
  active: ActivePage | null;
} | null>(null);

/** One visited hero page per layout context; never a substitute for version admission. */
export function HeroTabCache({
  children,
  title,
  identity,
}: {
  children: ReactNode;
  title: string;
  identity: string;
}) {
  const release = useRelease();
  const locale = useLocale();
  return (
    <HeroTabSession
      contextKey={`${identity}:${release}:${locale}`}
      title={title}
    >
      {children}
    </HeroTabSession>
  );
}

function HeroTabSession({
  children,
  title,
  contextKey,
}: {
  children: ReactNode;
  title: string;
  contextKey: string;
}) {
  const release = useRelease();
  const locale = useLocale();
  const pathname = usePathname();
  const snapshot = useRef<Snapshot | null>(null);
  const sequence = useRef(0);
  const [active, setActive] = useState<ActivePage | null>(null);
  const register = useCallback(
    (props: HeroPageProps) => {
      if (props.initialErrors.length || window.location.pathname !== "/heroes")
        return;
      try {
        snapshot.current = {
          contextKey,
          props,
          scope: browserScope(),
          expires: Date.now() + 300_000,
        };
      } catch {
        /* An unverified environment cannot seed navigation. */
      }
    },
    [contextKey],
  );
  const restore = useCallback(
    (url: URL): HeroPageProps | null => {
      const saved = snapshot.current;
      if (
        !saved ||
        saved.contextKey !== contextKey ||
        saved.expires < Date.now() ||
        !release ||
        url.pathname !== "/heroes" ||
        url.searchParams.get("release") !== release ||
        url.searchParams.get("lang") !== locale
      )
        return null;
      try {
        if (browserScope() !== saved.scope) return null;
        const replica = peekBrowserReplica({
          entity: "heroes",
          locale: gameLocale(locale),
          datasetVersionId: saved.props.initialSlice.datasetVersionId,
          assetDatasetVersionId: saved.props.initialSlice.assetDatasetVersionId,
        });
        if (!replica) return null;
        const params: SearchParams = {};
        for (const [key, value] of url.searchParams) {
          if (
            key === "release" ||
            CATALOG_PRESENTATION_KEYS.some((field) => field === key)
          )
            continue;
          const previous = params[key];
          params[key] =
            previous === undefined
              ? value
              : [...(Array.isArray(previous) ? previous : [previous]), value];
        }
        params.lang = gameLocale(locale);
        const parsed = parseHeroFilters(params);
        if (parsed.errors.length) return null;
        return {
          ...saved.props,
          initialFilters: parsed.filters,
          initialErrors: [],
          initialSlice: queryReplica(
            replica,
            parsed.filters,
          ) as HeroPageProps["initialSlice"],
        };
      } catch {
        return null;
      }
    },
    [release, locale, contextKey],
  );
  const pageEntry = useCallback(
    (props: HeroPageProps): ActivePage => ({
      contextKey,
      props,
      entry: ++sequence.current,
      title,
    }),
    [title, contextKey],
  );
  const navigate = useCallback(() => {
    const url = new URL(
      withLocale(withRelease("/heroes", release), locale),
      window.location.origin,
    );
    const props = restore(url);
    if (!props) {
      if (active && window.location.pathname === "/heroes") {
        window.location.assign(url.href);
        return true;
      }
      return false;
    }
    // Native history is supported by Next and updates usePathname/useSearchParams.
    // The actual catalog remains fully interactive throughout this local navigation.
    if (url.href === window.location.href)
      window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    setActive(pageEntry(props));
    window.scrollTo(0, 0);
    return true;
  }, [release, locale, restore, pageEntry, active]);
  useEffect(() => {
    if (snapshot.current?.contextKey !== contextKey) snapshot.current = null;
    // Cache validated inputs and images, not speculative React trees. Hidden
    // renders can create responsive images that never commit to the document.
    const timer = setTimeout(() => {
      setActive((current) =>
        pathname === "/heroes" && current?.contextKey === contextKey
          ? current
          : null,
      );
    }, 0);
    const expiry = setTimeout(
      () => {
        if (pathname !== "/heroes") {
          snapshot.current = null;
        }
      },
      Math.max(0, (snapshot.current?.expires ?? Date.now()) - Date.now()),
    );
    return () => {
      clearTimeout(timer);
      clearTimeout(expiry);
    };
  }, [pathname, contextKey]);
  useEffect(() => {
    const pop = () => {
      if (window.location.pathname !== "/heroes") {
        setActive(null);
        // A cached entry was created with native history on a different server
        // tree. Re-enter the history destination through its own document when
        // leaving that entry, rather than showing whichever tree Next retained.
        if (active) window.location.replace(window.location.href);
        return;
      }
      const props = restore(new URL(window.location.href));
      if (props) setActive(pageEntry(props));
      // Native entries carry the previous server tree. If their data has expired,
      // recover the URL from the server instead of exposing that unrelated tree.
      else window.location.replace(window.location.href);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [restore, pageEntry, active]);
  return (
    <HeroTabContext
      value={{
        register,
        navigate,
        active: active?.contextKey === contextKey ? active : null,
      }}
    >
      {children}
    </HeroTabContext>
  );
}

export function useHeroTabNavigation() {
  return useContext(HeroTabContext)?.navigate;
}

export function HeroTabOutlet({ children }: { children: ReactNode }) {
  const context = useContext(HeroTabContext);
  const pathname = usePathname();
  const visible = Boolean(context?.active && pathname === "/heroes");
  const page = context?.active;
  const title = useRef<HTMLTitleElement>(null);
  useLayoutEffect(() => {
    if (!visible) return;
    // A previous route can finish streaming metadata after this local navigation.
    // Keep our owned title first; leave the router's node intact for the next route.
    const prioritize = () => {
      const first = document.head.querySelector("title");
      if (title.current && first !== title.current)
        document.head.insertBefore(title.current, first);
    };
    prioritize();
    const observer = new MutationObserver(prioritize);
    observer.observe(document.head, { childList: true });
    return () => observer.disconnect();
  }, [visible]);
  return (
    <>
      {visible && page && <title ref={title}>{page.title}</title>}
      {visible && page ? (
        <HeroPage key={page.entry} {...page.props} cached />
      ) : (
        children
      )}
    </>
  );
}

export function VisitedHeroPage(props: HeroPageProps) {
  const register = useContext(HeroTabContext)?.register;
  useEffect(() => {
    register?.(props);
  }, [register, props]);
  return <HeroPage {...props} />;
}

function HeroPage({
  cached = false,
  ...props
}: HeroPageProps & { cached?: boolean }) {
  return (
    <main
      className="mx-auto max-w-[var(--content-max)] px-4 py-4 sm:px-6"
      onClickCapture={
        cached
          ? (event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              const anchor =
                event.target instanceof Element
                  ? event.target.closest<HTMLAnchorElement>("a[href]")
                  : null;
              if (
                !anchor ||
                anchor.hasAttribute("download") ||
                (anchor.target && anchor.target !== "_self")
              )
                return;
              const url = new URL(anchor.href);
              if (
                url.origin !== location.origin ||
                !url.pathname.startsWith("/heroes/")
              )
                return;
              // This local projection still sits on the previous server route tree.
              // Leave through a document navigation so the detail receives its own
              // server tree, instead of transitioning on the previous route tree.
              event.preventDefault();
              window.location.assign(url.href);
            }
          : undefined
      }
    >
      <LiveHeroCatalog {...props} />
    </main>
  );
}
