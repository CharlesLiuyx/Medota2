import type { NextAdapter } from "next";

export function isLocalBuildPath(file: string, dist: string): boolean;
export function pruneBuildTraces(context: {
  projectDir: string;
  distDir: string;
}): Promise<{ traces: number; removed: number }>;
export function assertStandaloneBoundary(
  standalone: string,
  dist: string,
): Promise<void>;
declare const adapter: NextAdapter;
export default adapter;
