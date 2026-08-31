import {
  type DataClass,
  type ResetPolicy,
  type RuntimeEnvironment,
} from "@/domain/environment";

export const LOCAL_STACK_ADOPTION_CONFIRMATION =
  "adopt:medota2,medota2_local,medota2_test";

export type LocalDatabaseName = "medota2" | "medota2_local" | "medota2_test";

export interface LocalDatabaseSpec {
  databaseName: LocalDatabaseName;
  environment: Exclude<RuntimeEnvironment, "production">;
  dataClass: Exclude<DataClass, "live-production">;
  resetPolicy: Exclude<ResetPolicy, "never">;
}

export const LOCAL_STACK_DATABASES = [
  {
    databaseName: "medota2",
    environment: "development",
    dataClass: "sandbox",
    resetPolicy: "manual",
  },
  {
    databaseName: "medota2_local",
    environment: "local-review",
    dataClass: "production-snapshot",
    resetPolicy: "explicit-rebuild",
  },
  {
    databaseName: "medota2_test",
    environment: "test",
    dataClass: "synthetic-fixture",
    resetPolicy: "run-scoped",
  },
] as const satisfies readonly LocalDatabaseSpec[];

export class LocalStackAdoptionError extends Error {
  constructor(message: string, cause?: unknown) {
    super(
      "Local environment adoption refused: " +
        message +
        " No product migration or business-data operation was run.",
      { cause },
    );
    this.name = "LocalStackAdoptionError";
  }
}

export function assertAdoptionConfirmation(confirmation: string): void {
  if (confirmation !== LOCAL_STACK_ADOPTION_CONFIRMATION) {
    throw new LocalStackAdoptionError(
      "pass --confirm " + LOCAL_STACK_ADOPTION_CONFIRMATION + " exactly.",
    );
  }
}
