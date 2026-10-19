import { maintainSyncStorage } from "@/development/data-sync/storage";
import { auditStorage } from "@/development/storage-audit";
import { parseArgs } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { maintainStorage, type StorageScope } from "@/development/storage";

async function main(): Promise<void> {
  loadLocalEnv();
  const { values } = parseArgs({
    options: {
      audit: { type: "boolean" },
      compact: { type: "boolean" },
      "restore-sync": { type: "string" },
      apply: { type: "boolean" },
      scope: { type: "string" },
    },
    allowPositionals: false,
  });
  if (values.audit) {
    if (
      values.apply ||
      values.scope ||
      values.compact ||
      values["restore-sync"]
    )
      throw new Error("--audit cannot be combined with cleanup options.");
    console.log(JSON.stringify(await auditStorage(), null, 2));
    return;
  }
  if (
    values.scope &&
    !["releases", "tests", "data-sync"].includes(values.scope)
  )
    throw new Error("--scope must be releases, tests or data-sync.");
  if (values["restore-sync"]) {
    if (values.apply || values.scope || values.compact)
      throw new Error("--restore-sync must be used alone.");
    console.log(
      JSON.stringify(
        await maintainSyncStorage({ restore: values["restore-sync"] }),
        null,
        2,
      ),
    );
    return;
  }
  if (values.compact && values.scope && values.scope !== "data-sync")
    throw new Error("--compact is only for sync payloads.");
  const sync =
    !values.scope || values.scope === "data-sync"
      ? await maintainSyncStorage({
          apply: values.apply,
          compact: values.compact,
        })
      : undefined;
  const plan = await maintainStorage({
    apply: values.apply,
    scope: values.scope as StorageScope | undefined,
  });
  console.log(
    JSON.stringify(
      { mode: values.apply ? "applied" : "preview", ...plan, sync },
      null,
      2,
    ),
  );
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
