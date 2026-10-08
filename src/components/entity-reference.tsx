"use client";
import Image from "next/image";
import styles from "./entity-reference.module.css";
import { useState, type ReactNode } from "react";
import { Box, Gem, Shield, Sparkles, Swords, UserRound } from "lucide-react";
import { useTranslations } from "@/i18n/provider";
import type { EntityPreview } from "@/presentation/entity-preview";
import { HoverTooltip } from "./ui/hover-tooltip";
import valveAssetImageLoader from "./valve-asset-image-loader";

export function EntityGlyph({ entity }: { entity: EntityPreview }) {
  const [failed, setFailed] = useState<string>();
  const t = useTranslations();
  const Icon = {
    hero: UserRound,
    ability: Sparkles,
    item: Gem,
    unit: Swords,
    attribute: Shield,
    mechanism: Shield,
    other: Box,
  }[entity.kind];
  return (
    <span className={`${styles.icon} ${styles[entity.kind] ?? ""}`}>
      {entity.icon && failed !== entity.icon ? (
        <Image
          loader={valveAssetImageLoader}
          src={entity.icon}
          alt={t("{name} 图标", { name: entity.name })}
          fill
          sizes="32px"
          onError={() => setFailed(entity.icon)}
        />
      ) : (
        <Icon aria-hidden="true" className="size-4" />
      )}
    </span>
  );
}
export function EntitySummaryCard({ entity }: { entity: EntityPreview }) {
  const t = useTranslations();
  return (
    <div className={styles.summary}>
      <div className="flex items-center gap-2">
        <EntityGlyph entity={entity} />
        <strong>{entity.name}</strong>
      </div>
      <p className="mt-2 text-[var(--text-secondary)]">
        {entity.description || t("简述待补充")}
      </p>
      {!!entity.facts?.length && (
        <dl className="mt-2">
          {entity.facts.map((fact, index) => (
            <div key={index}>
              <dt className="text-[var(--text-muted)]">
                {fact.entity ? (
                  <EntityReference entity={fact.entity} inline />
                ) : (
                  fact.label
                )}
              </dt>
              <dd className="tabular-nums">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
/** Lightweight, non-interactive width sample using the same inline icon geometry. */
export function EntityReferenceWidthSample({
  entity,
}: {
  entity: EntityPreview;
}) {
  return (
    <span className={`${styles.reference} ${styles.inline}`}>
      <span className={`${styles.icon} ${styles[entity.kind] ?? ""}`} />
      <span>{entity.name}</span>
    </span>
  );
}

export function EntityReference({
  entity,
  children,
  icon = true,
  inline = false,
}: {
  entity: EntityPreview;
  children?: ReactNode;
  icon?: boolean;
  inline?: boolean;
}) {
  return (
    <HoverTooltip
      href={entity.href}
      className={`${styles.reference}${inline ? ` ${styles.inline}` : ""}`}
      content={<EntitySummaryCard entity={entity} />}
    >
      {icon && <EntityGlyph entity={entity} />}
      <span>{children ?? entity.name}</span>
    </HoverTooltip>
  );
}

/** Longest exact entity names win; unmatched prose remains readable text. */
export function EntityText({
  text,
  entities,
}: {
  text: string;
  entities: EntityPreview[];
}) {
  const names = [...entities]
    .filter((entity) => entity.name.length >= 2)
    .sort((a, b) => b.name.length - a.name.length);
  const parts: ReactNode[] = [];
  let plain = "",
    cursor = 0;
  while (cursor < text.length) {
    const entity = names.find((candidate) =>
      text.startsWith(candidate.name, cursor),
    );
    if (entity) {
      if (plain) parts.push(plain);
      plain = "";
      parts.push(
        <EntityReference
          key={`${cursor}:${entity.key}`}
          entity={entity}
          inline
        />,
      );
      cursor += entity.name.length;
    } else plain += text[cursor++];
  }
  if (plain) parts.push(plain);
  return <>{parts}</>;
}
