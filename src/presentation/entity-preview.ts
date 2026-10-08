import {
  attributeDefinition,
  attributeId,
  type AttributeOwnerKind,
} from "@/domain/attributes";
import { withRelease } from "@/domain/releases";
import type { Translator } from "@/i18n/messages";

/** A small, version-pinned entity projection shared by inline references and hover cards. */
export interface EntityPreview {
  key: string;
  name: string;
  kind:
    "hero" | "ability" | "item" | "unit" | "attribute" | "mechanism" | "other";
  href?: string;
  icon?: string;
  description?: string;
  facts?: Array<{ label: string; value: string; entity?: EntityPreview }>;
}

/** Stable field identity, shared by object summaries and attribute links. */
export function attributePreview(
  kind: AttributeOwnerKind,
  owner: string,
  field: string,
  label: string,
  t: Translator,
  labelToken?: string,
  release?: string,
): EntityPreview {
  const id = attributeId(kind, owner, field, labelToken);
  const definition = attributeDefinition(id);
  const href = `/attributes/${encodeURIComponent(id)}`;
  return {
    key: id,
    kind: "attribute",
    name: label,
    href: release ? withRelease(href, release) : href,
    description: definition
      ? t(definition.summary)
      : t("该对象的专属参数；具体作用以同版本技能或物品说明为准。"),
  };
}
