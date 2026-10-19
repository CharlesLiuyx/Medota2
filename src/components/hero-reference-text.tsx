"use client";

import {
  createContext,
  useContext,
  useId,
  useMemo,
  type ReactNode,
} from "react";
import { ATTRIBUTES, attributeDefinition } from "@/domain/attributes";
import { useLocale, useTranslations } from "@/i18n/provider";
import { attributeTextParts } from "@/presentation/attribute-text";
import { displayName, type TooltipAbility } from "@/presentation/dota";
import { AbilityTooltip } from "./ability-tooltip";
import { EntitySummaryCard } from "./entity-reference";
import { HoverTooltip } from "./ui/hover-tooltip";

const References = createContext<{
  abilities: readonly TooltipAbility[];
  tokens: Record<string, string>;
  assetVersion: string;
} | null>(null);

/** Reuse the page's pinned spellbook; hover never fetches another version. */
export function HeroReferenceProvider({
  children,
  ...value
}: {
  abilities: readonly TooltipAbility[];
  tokens: Record<string, string>;
  assetVersion: string;
  children: ReactNode;
}) {
  return <References.Provider value={value}>{children}</References.Provider>;
}

export function HeroReferenceText({ text }: { text: string }) {
  const context = useContext(References);
  const locale = useLocale();
  const t = useTranslations();
  const id = useId();
  const terms = useMemo(
    () => [
      ...ATTRIBUTES,
      ...(context?.abilities ?? []).map((ability) => {
        const name = displayName(ability.display_name, "", undefined, locale);
        return { id: `ability:${ability.internal_name}`, zh: name, en: name };
      }),
    ],
    [context?.abilities, locale],
  );
  const parts = useMemo(
    () => attributeTextParts(text, locale, terms),
    [text, locale, terms],
  );
  return parts.map((part, index) => {
    const key = part.attributeId;
    if (!key) return part.text;
    const ability = key.startsWith("ability:")
      ? context?.abilities.find((entry) => entry.internal_name === key.slice(8))
      : undefined;
    const definition = attributeDefinition(key);
    if (!ability && !definition) return part.text;
    return (
      <HoverTooltip
        key={`${index}:${key}`}
        href={
          ability
            ? `#skill-${ability.internal_name}`
            : `/attributes/${encodeURIComponent(key)}${part.enumValue ? `#${encodeURIComponent(part.enumValue)}` : ""}`
        }
        className="pointer-events-auto inline rounded-sm underline decoration-current/35 decoration-dotted underline-offset-2 hover:text-[#f3d58e] focus-visible:outline-2 focus-visible:outline-[#e4c584]"
        content={
          ability && context ? (
            <div className="max-h-[min(320px,40vh)] overflow-y-auto overscroll-contain">
              <AbilityTooltip
                id={`${id}-${index}`}
                ability={ability}
                tokens={context.tokens}
                assetVersion={context.assetVersion}
                adjustableLevel
              />
            </div>
          ) : (
            <EntitySummaryCard
              entity={{
                key,
                kind: "attribute",
                name: locale === "en" ? definition!.en : definition!.zh,
                description: t(definition!.summary),
              }}
            />
          )
        }
      >
        {part.text}
      </HoverTooltip>
    );
  });
}
