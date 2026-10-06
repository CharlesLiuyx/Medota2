import { expect, it } from "vitest";
import { parseCurrents } from "@/importers/dota-map/currents";
const dump = `====1====
classname "dota_movespeed_modifier_path"
origin [100,200,300]
angles [0,180,0]
pathnodes """
[[0,0,0,0,0,0,32,0,0],[96,0,0,-32,0,0,0,0,0],]
"""
pathnoderadiusscales """
[64,128,]
"""
pathnodemovespeedtypes """
["1","2",]
"""
`;
it("reconstructs native curve direction including the Dire yaw and validates source arrays", () => {
  const [path] = parseCurrents(dump, "fixture");
  expect(path.id).toBe("fixture:1");
  expect(path.samples[0]).toEqual({ x: 100, y: 200, z: 300, radius: 64 });
  expect(path.samples.at(-1)!.x).toBeCloseTo(4);
  expect(path.samples.at(-1)!.y).toBeCloseTo(200);
  expect(path.samples.at(-1)!.radius).toBe(128);
  expect(path.maxBonus).toBe(150);
  expect(() =>
    parseCurrents(dump.replace("[64,128,]", "[64,]"), "fixture"),
  ).toThrow("count mismatch");
  expect(() =>
    parseCurrents(dump.replace('["1","2",]', '["1","9",]'), "fixture"),
  ).toThrow("Unknown");
  expect(() => parseCurrents(dump + dump, "fixture")).toThrow("Duplicate");
});
