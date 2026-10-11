import "server-only";
import { cache } from "react";
import { getWebDatabase } from "@/server/db/client";

/** Cache keys are made only after the existing database identity gate succeeds. */
export const verifiedResourceScope = cache(
  async function verifiedResourceScope() {
    const identity = await (await getWebDatabase()).verifyIdentity();
    return JSON.stringify([
      identity.environment,
      identity.dataClass,
      identity.runId,
      identity.instanceId,
      identity.databaseId,
    ]);
  },
);
