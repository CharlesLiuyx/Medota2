export function requiredArgument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} <value> is required.`);
  }
  return value;
}
