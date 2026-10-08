import { expect, it } from "vitest";
import { reviewedInspectionContract } from "@/development/data-sync/inspection-schema";
import {
  assertReviewedSchema,
  schemaTables,
} from "@/development/data-sync/schema";
import {
  assertMigrations,
  collectDatabase,
} from "@/development/data-sync/database";
import { listMigrations } from "@/server/db/migrations";
import { digest } from "@/development/data-sync/protocol";
import current from "@/development/data-sync/schema.v1.json";
import type { VerifiedReadSnapshot } from "@/server/environment/contract";

const previous = {
  schemaDigest:
    "6b6b58fa96efb3d61c233c498ca8ccf088e958b6c71d1405f8278f9e68864ac2",
  migrationsDigest:
    "70586843fee5bb9143316eba6627ea29c159ff7a502db16f49cf564636447167",
};
async function migrations() {
  return (await listMigrations()).map(({ id, sha256 }) => ({ id, sha256 }));
}

it("verifies the exact published 0010 contract without accepting unknown schemas or altered migrations", async () => {
  const ledger = await migrations();
  const contract = reviewedInspectionContract(previous, ledger)!;
  expect(digest(contract.schema)).toBe(previous.schemaDigest);
  expect(schemaTables(contract.schema)).toHaveLength(34);
  expect(digest(contract.migrations)).toBe(previous.migrationsDigest);
  expect(() =>
    reviewedInspectionContract(
      { ...previous, schemaDigest: "a".repeat(64) },
      ledger,
    ),
  ).toThrow("no supported");
  expect(() =>
    reviewedInspectionContract(
      previous,
      ledger.map((entry, i) =>
        i === 0 ? { ...entry, sha256: "a".repeat(64) } : entry,
      ),
    ),
  ).toThrow("reviewed digests");
  expect(
    reviewedInspectionContract(
      { schemaDigest: digest(current), migrationsDigest: digest(ledger) },
      ledger,
    ),
  ).toBeUndefined();
});

it("still rejects live structure or ledger changes during historical inspection", async () => {
  const contract = reviewedInspectionContract(previous, await migrations())!;
  let changed = false;
  const reader = {
    query: async (sql: string) => ({
      rows: sql.includes("SELECT migration_id")
        ? contract.migrations
        : sql.includes("json_agg")
          ? changed
            ? current.columns
            : contract.schema.columns
          : sql.includes("pg_constraint")
            ? contract.schema.constraints
            : contract.schema.keys,
    }),
  } as unknown as VerifiedReadSnapshot;
  await assertReviewedSchema(reader, contract.schema);
  await assertMigrations(reader, contract.migrations);
  await expect(collectDatabase(reader, "unused", contract)).rejects.toThrow(
    "read-only inspection",
  );
  await expect(assertMigrations(reader)).rejects.toThrow("Migration ledger");
  changed = true;
  await expect(assertReviewedSchema(reader, contract.schema)).rejects.toThrow(
    "Database schema differs",
  );
});
