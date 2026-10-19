/** Keep these sizes in sync with the actual catalog image components. */
export const HERO_PORTRAIT_SIZES =
  "(min-width: 640px) 96px, (min-width: 360px) 25vw, 33vw";
export const VIEWPORT_CATALOGS = [
  "heroes",
  "abilities",
  "units",
  "items",
] as const;
export type ViewportCatalog = (typeof VIEWPORT_CATALOGS)[number];
export interface ViewportAsset {
  src: string;
  sizes: string;
}

/** Conservative first-screen budget, including a partial row. Never the whole catalog. */
export function viewportAssetLimit(
  entity: ViewportCatalog,
  width: number,
  height: number,
) {
  const columns =
    entity === "heroes"
      ? width >= 1400
        ? 15
        : width >= 1180
          ? 12
          : width >= 1024
            ? 10
            : width >= 768
              ? 8
              : width >= 640
                ? 6
                : width >= 360
                  ? 4
                  : 3
      : entity === "abilities"
        ? width >= 1400
          ? 8
          : width >= 1180
            ? 6
            : width >= 900
              ? 4
              : width >= 640
                ? 3
                : 2
        : width >= 1536
          ? 8
          : width >= 1280
            ? 6
            : width >= 768
              ? 4
              : width >= 640
                ? 3
                : 2;
  const rowHeight =
    entity === "heroes"
      ? (((Math.min(width, 1480) - 32) / columns - 4) * 9) / 16 + 4
      : entity === "abilities"
        ? 62
        : 74;
  return Math.min(
    192,
    Math.max(
      columns,
      Math.ceil(Math.max(0, height - 72) / rowHeight) * columns,
    ),
  );
}
