import {
  attributeTextParts,
  type AttributeTextAttribute,
} from "@/presentation/attribute-text";
import Link from "./version-link";

export function AttributeText({
  text,
  locale,
  attributes,
}: {
  text: string;
  locale: "zh-CN" | "en";
  attributes: AttributeTextAttribute[];
}) {
  return attributeTextParts(text, locale, attributes).map((part, index) =>
    part.attributeId ? (
      <Link
        key={index}
        href={`/attributes/${encodeURIComponent(part.attributeId)}${part.enumValue ? `#${encodeURIComponent(part.enumValue)}` : ""}`}
        prefetch={false}
        data-attribute-reference={part.attributeId}
        data-attribute-enum-value={part.enumValue}
        className="text-[#c4a16a] underline decoration-[#c4a16a]/60 underline-offset-4 hover:text-[#e4c48e] focus-visible:bg-white/5"
      >
        {part.text}
      </Link>
    ) : (
      part.text
    ),
  );
}
