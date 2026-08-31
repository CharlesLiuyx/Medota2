import {
  assertAdoptionConfirmation,
  LOCAL_STACK_ADOPTION_CONFIRMATION,
} from "@/server/environment/adopt-local-stack";
import { isolateLocalStack } from "@/server/environment/isolate-local-stack";
import { writeLocalEnvironmentReceipt } from "@/config/environment-receipt";
import { requiredArgument } from "./cli-args";

async function main(): Promise<void> {
  const confirmation = requiredArgument("confirm");
  assertAdoptionConfirmation(confirmation);
  const result = await isolateLocalStack({
    confirmation,
    onProgress: (message) => console.log(message),
  });
  const receiptPath = writeLocalEnvironmentReceipt(result.receipt);

  console.log(
    "Local stack environment identity verified. Instance fingerprint: " +
      result.receipt.instanceId.slice(0, 8),
  );
  for (const [environment, database] of Object.entries(
    result.receipt.databases,
  )) {
    console.log(
      [
        database.databaseName,
        result.changedDatabases.includes(database.databaseName)
          ? "isolated"
          : "unchanged",
        environment,
        "database fingerprint " + database.databaseId.slice(0, 8),
      ].join(" · "),
    );
  }
  console.log("Provisioning receipt written to " + receiptPath + ".");
  console.log(
    "Runtime credentials written to " + result.runtimeCredentialPath + ".",
  );
  console.log(
    "Control credential written to " + result.controlCredentialPath + ".",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "Explicit confirmation example: --confirm " +
      LOCAL_STACK_ADOPTION_CONFIRMATION,
  );
  process.exitCode = 1;
});
