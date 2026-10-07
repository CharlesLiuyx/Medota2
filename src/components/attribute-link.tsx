"use client";
import type { ReactNode } from "react";
import Link from "./version-link";
import { attributeId, type AttributeOwnerKind } from "@/domain/attributes";
export function AttributeLink({
  kind,
  owner,
  field,
  labelToken,
  children,
}: {
  kind: AttributeOwnerKind;
  owner: string;
  field: string;
  labelToken?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={`/attributes/${encodeURIComponent(attributeId(kind, owner, field, labelToken))}`}
      prefetch={false}
      className="decoration-[#c4a16a]/50 underline underline-offset-4 hover:text-[#c4a16a]"
    >
      {children}
    </Link>
  );
}
