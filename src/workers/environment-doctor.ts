import { verifyDeclaredEnvironmentConvergence } from "@/server/environment/contract";

async function main(): Promise<void> {
  const identities = await verifyDeclaredEnvironmentConvergence();
  const identity = identities[0];
  console.log(
    JSON.stringify(
      {
        environment: identity.environment,
        dataClass: identity.dataClass,
        databaseName: identity.databaseName,
        runId: identity.runId,
        safeFingerprint: identity.safeFingerprint,
        roles: identities.map((candidate) => candidate.databaseRole),
        status: "verified",
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
