export interface CheckTask {
  id: string;
  reason: string;
  command: string;
  args: string[];
  inputs: string[];
  kind: "static" | "browser" | "database" | "build" | "benchmark";
}
export interface CheckPlan {
  schemaVersion: 1;
  paths: string[];
  tasks: CheckTask[];
  browser: boolean;
  database: boolean;
  summary: string;
}
export function changedFiles(base?: string): string[];
export function createPlan(paths: string[]): CheckPlan;
export function publicationPlan(
  plan: CheckPlan,
  fixtureOnly?: boolean,
): CheckPlan;
export function parseArguments(args: string[]): {
  base?: string;
  files?: string[];
  plan: boolean;
  json: boolean;
  force: boolean;
  watch: boolean;
  publication: boolean;
};

export function warmRoutesForScopes(scopes?: string[]): string[];
