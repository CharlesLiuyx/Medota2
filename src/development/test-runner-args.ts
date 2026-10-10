/** pnpm may retain the wrapper separator; never forward it as runner data. */
export function normalizeTestRunnerArgs(args: readonly string[]): string[] {
  const forwarded = args[0] === "--" ? args.slice(1) : [...args];
  if (forwarded.includes("--"))
    throw new Error(
      "Use -- only before all test runner arguments; an interior separator would turn options into test filters.",
    );
  return forwarded;
}
