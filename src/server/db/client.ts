import "server-only";
import {
  openVerifiedDatabase,
  type VerifiedDatabase,
} from "@/server/environment/contract";

interface DatabaseGlobal {
  medota2WebDatabase?: Promise<VerifiedDatabase<"read">>;
}

const databaseGlobal = globalThis as typeof globalThis & DatabaseGlobal;

export function getWebDatabase(): Promise<VerifiedDatabase<"read">> {
  if (!databaseGlobal.medota2WebDatabase) {
    const pending = openVerifiedDatabase({
      role: "web",
      operation: "read",
    });
    databaseGlobal.medota2WebDatabase = pending;
    void pending.catch(() => {
      if (databaseGlobal.medota2WebDatabase === pending) {
        delete databaseGlobal.medota2WebDatabase;
      }
    });
  }
  return databaseGlobal.medota2WebDatabase;
}
