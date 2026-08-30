import "server-only";
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { getDatabaseUrl } from "@/config/env";
import * as schema from "./schema";

const { Pool } = pg;

interface DatabaseGlobal {
  medota2WebPool?: pg.Pool;
  medota2WebDatabase?: NodePgDatabase<typeof schema>;
}

const databaseGlobal = globalThis as typeof globalThis & DatabaseGlobal;

export function getWebPool(): pg.Pool {
  if (!databaseGlobal.medota2WebPool) {
    databaseGlobal.medota2WebPool = new Pool({
      connectionString: getDatabaseUrl("web"),
      application_name: "medota2-web",
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return databaseGlobal.medota2WebPool;
}

export function getWebDatabase(): NodePgDatabase<typeof schema> {
  if (!databaseGlobal.medota2WebDatabase) {
    databaseGlobal.medota2WebDatabase = drizzle(getWebPool(), { schema });
  }
  return databaseGlobal.medota2WebDatabase;
}
