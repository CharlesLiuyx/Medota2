import {
  provisionDataStack,
  startPersistentDataStack,
  stopPersistentDataStack,
} from "@/server/environment/data-stack-lifecycle";
import { requiredArgument } from "./cli-args";

type PersistentEnvironment = "development" | "local-review";
type StackAction = "provision" | "start" | "stop";

async function main(): Promise<void> {
  const action = requiredArgument("action") as StackAction;
  const environment = requiredArgument("environment") as PersistentEnvironment;
  if (!(["provision", "start", "stop"] as const).includes(action)) {
    throw new Error("--action must be provision, start, or stop.");
  }
  if (!(["development", "local-review"] as const).includes(environment)) {
    throw new Error("--environment must be development or local-review.");
  }

  if (action === "provision") {
    const confirmation = requiredArgument("confirm");
    const expected = `provision:${environment}`;
    if (confirmation !== expected) {
      throw new Error(`Pass --confirm ${expected} exactly.`);
    }
    const lease = await provisionDataStack({
      environment,
      onProgress: (message) => console.log(message),
    });
    console.log(
      [
        `${environment} stack is active`,
        `project ${lease.composeProject}`,
        `127.0.0.1:${lease.hostPort}`,
        `state ${lease.stateDirectory}`,
      ].join(" · "),
    );
    console.log(
      "Provisioning created identities and credentials only; run the explicit migration/import command next.",
    );
    return;
  }

  if (action === "start") {
    await startPersistentDataStack(environment);
    console.log(`${environment} stack started.`);
    return;
  }

  await stopPersistentDataStack(environment);
  console.log(`${environment} stack stopped; its named volume was retained.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
