import { expect, it } from "vitest";
import {
  detectedObservers,
  snapVisionPosition,
  type PlacedVisionSource,
} from "@/domain/map/vision-sources";
it("snaps positive/negative positions and partial boundary cells to the coverage grid", () => {
  const bounds = { minX: -100, maxX: 90, minY: -100, maxY: 90 };
  expect(snapVisionPosition({ x: -99, y: -36 }, bounds)).toEqual({
    x: -68,
    y: -4,
  });
  expect(snapVisionPosition({ x: 200, y: -200 }, bounds)).toEqual({
    x: 59,
    y: -68,
  });
  const nativeBounds = { minX: -128, minY: -128, maxX: 128, maxY: 128 };
  expect(snapVisionPosition({ x: 20, y: 20 }, bounds, nativeBounds)).toEqual({
    x: 32,
    y: 32,
  });
  expect(snapVisionPosition({ x: 99, y: -200 }, bounds, nativeBounds)).toEqual({
    x: 32,
    y: -96,
  });
  expect(snapVisionPosition({ x: 20, y: 20 }, bounds)).toEqual(
    snapVisionPosition({ x: -30, y: -30 }, bounds),
  );
});
it("highlights only enemy Observer Wards within a displayed Sentry's inclusive range", () => {
  const ward: PlacedVisionSource = {
    id: "s",
    x: 0,
    y: 0,
    kind: "sentry",
    presetKey: "sentry",
    team: "radiant",
    day: 0,
    night: 0,
    detection: 1050,
  };
  const observer: PlacedVisionSource = {
    ...ward,
    id: "o",
    kind: "observer",
    team: "dire",
    x: 1050,
  };
  expect([...detectedObservers([ward, observer], ["radiant"])]).toEqual(["o"]);
  expect(
    detectedObservers([ward, { ...observer, x: 1050.01 }], ["radiant"]).size,
  ).toBe(0);
  expect(
    detectedObservers([ward, { ...observer, team: "radiant" }], ["radiant"])
      .size,
  ).toBe(0);
  expect(
    detectedObservers([ward, { ...observer, kind: "hero" }], ["radiant"]).size,
  ).toBe(0);
  expect(detectedObservers([ward, observer], ["dire"]).size).toBe(0);
});
