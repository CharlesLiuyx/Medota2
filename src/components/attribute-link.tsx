"use client";
import type { ReactNode } from "react";
import { useTranslations } from "@/i18n/provider";
import { EntityReference } from "./entity-reference";
import { attributePreview } from "@/presentation/entity-preview";
import {
  attributeDefinition,
  attributeId,
  type AttributeOwnerKind,
} from "@/domain/attributes";
export function AttributeLink({
  kind,
  owner,
  field,
  labelToken,
  children,
  label: explicitLabel,
  icon = true,
  value,
}: {
  kind: AttributeOwnerKind;
  owner: string;
  field: string;
  labelToken?: string;
  children: ReactNode;
  label?: string;
  icon?: boolean;
  value?: string;
}) {
  const t = useTranslations();
  const definition = attributeDefinition(
    attributeId(kind, owner, field, labelToken),
  );
  const label =
    explicitLabel ??
    (typeof children === "string" ? children : t(definition?.zh ?? field));
  return (
    <EntityReference
      entity={{
        ...attributePreview(kind, owner, field, label, t, labelToken),
        attributeField: field,
        attributeValue:
          value ??
          (typeof children === "string" && /^[+-]?[\d.]+%?$/.test(children)
            ? children
            : undefined),
      }}
      inline
      icon={icon}
    >
      {children}
    </EntityReference>
  );
}
