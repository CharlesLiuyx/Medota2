import { parseArgs } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { maintainStorage, type StorageScope } from "@/development/storage";

async function main(): Promise<void> {
  loadLocalEnv();
  const { values } = parseArgs({
    options: { apply: { type: "boolean" }, scope: { type: "string" } },
    allowPositionals: false,
  });
  if (values.scope && !["releases", "tests"].includes(values.scope))
    throw new Error("--scope must be releases or tests.");
  const plan = await maintainStorage({
    apply: values.apply,
    scope: values.scope as StorageScope | undefined,
  });
  console.log(
    JSON.stringify(
      { mode: values.apply ? "applied" : "preview", ...plan },
      null,
      2,
    ),
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
