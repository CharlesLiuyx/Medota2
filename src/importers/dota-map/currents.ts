import { readEntityRecords } from "./adapter";
import { vector } from "./native";
import type { CurrentPath } from "@/domain/map/currents";
/** Same-version native cubic path positions, incoming/outgoing handles and node radii. */
export function parseCurrents(text: string, sourcePath: string): CurrentPath[] {
  const array = (text: string | undefined): unknown[] => {
    if (!text) throw new Error("Missing current path field");
    const value: unknown = JSON.parse(text.replace(/,\s*([\]}])/g, "$1"));
    if (!Array.isArray(value)) throw new Error("Invalid current path array");
    return value;
  };
  return readEntityRecords(text, sourcePath)
    .filter((r) => r.properties.classname === "dota_movespeed_modifier_path")
    .map(({ id, properties: p }) => {
      const origin = vector(p.origin),
        angles = vector(p.angles ?? "0 0 0"),
        scales = vector(p.scales ?? "1 1 1");
      if (
        Math.abs(angles[0]) > 0.001 ||
        Math.abs(angles[2]) > 0.001 ||
        scales.some((v) => v !== 1) ||
        (p.parentname && p.parentname !== "(null)")
      )
        throw new Error("Unsupported current transform");
      const nodes = array(p.pathnodes),
        radii = array(p.pathnoderadiusscales),
        types = array(p.pathnodemovespeedtypes);
      if (
        nodes.length < 2 ||
        radii.length !== nodes.length ||
        types.length !== nodes.length
      )
        throw new Error("Current node count mismatch");
      if (types.some((t) => t !== "1" && t !== "2"))
        throw new Error("Unknown current speed type");
      const points = nodes.map((node, i) => {
        if (
          !Array.isArray(node) ||
          node.length !== 9 ||
          !node.every((v) => typeof v === "number" && Number.isFinite(v)) ||
          typeof radii[i] !== "number" ||
          !Number.isFinite(radii[i]) ||
          Number(radii[i]) <= 0
        )
          throw new Error("Invalid current node");
        return node as number[];
      });
      const samples: CurrentPath["samples"] = [];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i];
        const count = Math.max(
          1,
          Math.ceil(
            (Math.hypot(a[6], a[7], a[8]) +
              Math.hypot(
                b[0] + b[3] - a[0] - a[6],
                b[1] + b[4] - a[1] - a[7],
                b[2] + b[5] - a[2] - a[8],
              ) +
              Math.hypot(b[3], b[4], b[5])) /
              32,
          ),
        );
        for (let j = i === 1 ? 0 : 1; j <= count; j++) {
          const t = j / count,
            u = 1 - t;
          const coord = (k: number) =>
            u * u * u * a[k] +
            3 * u * u * t * (a[k] + a[k + 6]) +
            3 * u * t * t * (b[k] + b[k + 3]) +
            t * t * t * b[k];
          samples.push({
            x:
              origin[0] +
              coord(0) * Math.cos((angles[1] * Math.PI) / 180) -
              coord(1) * Math.sin((angles[1] * Math.PI) / 180),
            y:
              origin[1] +
              coord(0) * Math.sin((angles[1] * Math.PI) / 180) +
              coord(1) * Math.cos((angles[1] * Math.PI) / 180),
            z: origin[2] + coord(2),
            radius: Number(radii[i - 1]) * (1 - t) + Number(radii[i]) * t,
          });
        }
      }
      return { id, samples, maxBonus: 150 };
    });
}
