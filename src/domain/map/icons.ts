export const MAP_ICON_PROVIDER = "map-package-icons-v1";
export type MapIcon = {
  key: string;
  label: string;
  group: "map" | "hero" | "material" | "hud" | "supplement";
  url: string;
  width: number;
  height: number;
};
export type MapIconSet = {
  bundleVersion: string;
  icons: MapIcon[];
  points: Record<string, string>;
  missing: string[];
};
