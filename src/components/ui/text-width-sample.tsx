"use client";
import { useCallback } from "react";

interface TextSample {
  texts: readonly string[];
  tabular: boolean;
  measuredFont?: string;
}
const samples = new WeakMap<HTMLElement, TextSample>();
let context: CanvasRenderingContext2D | null | undefined;
const digits = new Map<string, Map<string, number>>();
const widths = new Map<string, number>();

/** Register pure text; GroupedTable batches style reads, text writes and final widths. */
export function TextWidthSample({
  texts,
  tabular = false,
}: {
  texts: readonly string[];
  tabular?: boolean;
}) {
  const ref = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) samples.set(node, { texts, tabular });
    },
    [texts, tabular],
  );
  return (
    <span
      ref={ref}
      data-width-text=""
      className={tabular ? "tabular-nums" : undefined}
    />
  );
}

export function prepareTextWidthSamples(
  root: HTMLElement,
  fontsChanged = false,
) {
  context ??= document.createElement("canvas").getContext("2d");
  if (fontsChanged) {
    digits.clear();
    widths.clear();
  }
  // Read all computed fonts before changing any sample: no layout per column.
  const entries = [
    ...root.querySelectorAll<HTMLElement>("[data-width-text]"),
  ].flatMap((node) => {
    const sample = samples.get(node);
    if (!sample) return [];
    const style = getComputedStyle(node);
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const fontKey = `${font}:${style.letterSpacing}:${style.fontKerning}:${style.fontVariantNumeric}`;
    return [
      {
        node,
        sample,
        font,
        fontKey,
        spacing: style.letterSpacing,
        kerning: style.fontKerning,
      },
    ];
  });
  for (const { node, sample, font, fontKey, spacing, kerning } of entries) {
    if (!fontsChanged && sample.measuredFont === fontKey) continue;
    if (context) {
      context.font = font;
      context.letterSpacing = spacing;
      context.fontKerning = kerning as CanvasFontKerning;
    }
    let adjustments = digits.get(fontKey);
    // Canvas lacks tabular-nums: calibrate ten digits once per real font, shared by all columns.
    if (sample.tabular && context && !adjustments) {
      adjustments = new Map();
      for (const digit of "0123456789") {
        node.textContent = digit;
        adjustments.set(
          digit,
          node.getBoundingClientRect().width - context.measureText(digit).width,
        );
      }
      digits.set(fontKey, adjustments);
      if (digits.size > 32) digits.delete(digits.keys().next().value!);
    }
    let widest = "—",
      width = -1;
    for (const raw of sample.texts) {
      const text = raw.replace(/\s+/gu, " ");
      const cacheKey = `${fontKey}:${sample.tabular}:${text}`;
      let measured = widths.get(cacheKey);
      if (measured === undefined) {
        if (context) {
          measured = context.measureText(text).width;
          if (sample.tabular)
            for (const digit of text.match(/\d/g) ?? [])
              measured += adjustments?.get(digit) ?? 0;
        } else {
          node.textContent = text;
          measured = node.getBoundingClientRect().width;
        }
        widths.set(cacheKey, measured);
        if (widths.size > 8192) widths.delete(widths.keys().next().value!);
      }
      if (measured > width) {
        widest = text;
        width = measured;
      }
    }
    node.textContent = widest;
    sample.measuredFont = fontKey;
  }
}
