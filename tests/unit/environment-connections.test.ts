import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openVerifiedDatabase } from "@/server/environment/contract";
import { EnvironmentContractError } from "@/server/environment/policy";

const state = vi.hoisted(() => ({
  environment: "local-review",
  attest: vi.fn(),
  clients: [] as Array<ReturnType<typeof client>>,
  pool: undefined as unknown as EventEmitter,
}));
vi.mock("@/config/env", () => ({
  assertProcessMayUseDatabaseRole: vi.fn(),
  getEnvironmentDeclaration: () => ({ environment: state.environment }),
  getExpectedDatabaseRoleName: (role: string) => role,
  getEnvironmentDatabaseUrl: () => "postgresql://web:private@127.0.0.1/db",
}));
vi.mock("@/server/environment/policy", async (original) => ({
  ...(await original<typeof import("@/server/environment/policy")>()),
  parseDatabaseEndpoint: () => ({}),
  attestEnvironment: state.attest,
}));
vi.mock("pg", () => ({
  default: {
    Pool: class extends EventEmitter {
      constructor() {
        super();
        state.pool = this;
      }
      connect() {
        return Promise.resolve(state.clients[0]);
      }
      end() {
        return Promise.resolve();
      }
    },
  },
}));
function client() {
  return Object.assign(new EventEmitter(), {
    query: vi.fn(async (sql: unknown) => {
      void sql;
      return {
        rowCount: 1,
        rows: [{ current_user_name: "web", session_user_name: "web" }],
      };
    }),
    release: vi.fn(),
  });
}
beforeEach(() => {
  vi.stubEnv("MEDOTA2_WORKBENCH", "1");
  state.environment = "local-review";
  state.clients = [client()];
  state.attest.mockReset().mockReturnValue({ environment: "local-review" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each(["development", "local-review"])(
  "reuses %s workbench identity but resets every session and reattests replacement sockets",
  async (environment) => {
    state.environment = environment;
    const db = await openVerifiedDatabase({ role: "web", operation: "read" });
    await db.query("SELECT 1");
    await db.query("SELECT 2");
    expect(state.attest).toHaveBeenCalledTimes(1);
    expect(
      state.clients[0].query.mock.calls.filter(
        ([sql]) => sql === "DISCARD ALL",
      ),
    ).toHaveLength(3);
    state.clients = [client()];
    await db.query("SELECT 3");
    expect(state.attest).toHaveBeenCalledTimes(2);
    // A role drift is rejected even on an already attested socket.
    state.clients[0].query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ current_user_name: "other", session_user_name: "web" }],
    });
    await expect(db.query("SELECT 4")).rejects.toMatchObject({
      code: "ENV_ROLE_MISMATCH",
    });
    expect(state.clients[0].release).toHaveBeenLastCalledWith(
      expect.any(Error),
    );
    await db.end();
  },
);

it.each(["test", "production", "standalone-review"])(
  "keeps fresh attestation in %s",
  async (environment) => {
    state.environment =
      environment === "standalone-review" ? "local-review" : environment;
    if (environment === "standalone-review")
      vi.stubEnv("MEDOTA2_WORKBENCH", "0");
    const db = await openVerifiedDatabase({ role: "web", operation: "read" });
    await db.query("SELECT 1");
    expect(state.attest).toHaveBeenCalledTimes(2);
    await db.end();
  },
);

it("survives idle disconnects, reconnects and rejects a replacement with identity drift", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const db = await openVerifiedDatabase({ role: "web", operation: "read" });
  expect(() =>
    state.pool.emit(
      "error",
      Object.assign(new Error("private connection"), { code: "ECONNRESET" }),
    ),
  ).not.toThrow();
  expect(warning).toHaveBeenCalledWith(
    "[database] idle connection removed",
    "unreachable",
  );
  state.clients = [client()];
  state.attest.mockImplementationOnce(() => {
    throw new EnvironmentContractError("ENV_TARGET_MISMATCH");
  });
  await expect(db.query("SELECT 1")).rejects.toMatchObject({
    code: "ENV_TARGET_MISMATCH",
  });
  state.clients = [client()];
  await expect(db.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
  await db.end();
});

it("discards sockets lost during reads and preserves SQL failures", async () => {
  const db = await openVerifiedDatabase({ role: "web", operation: "read" });
  const raw = Object.assign(new Error("private driver message"), {
    code: "ECONNRESET",
  });
  const query = state.clients[0].query.getMockImplementation()!;
  state.clients[0].query.mockImplementation(async (sql: unknown) => {
    if (typeof sql === "object") throw raw;
    return query(sql);
  });
  await expect(db.query("SELECT 1")).rejects.toMatchObject({
    code: "ENV_CONNECT_FAILED",
    connectionFailure: "unreachable",
  });
  expect(state.clients[0].release).toHaveBeenLastCalledWith(true);
  state.clients = [client()];
  await expect(db.query("SELECT 1")).resolves.toMatchObject({ rowCount: 1 });
  const syntax = Object.assign(new Error("syntax error"), { code: "42601" });
  state.clients[0].query.mockImplementation(async (sql: unknown) => {
    if (typeof sql === "object") throw syntax;
    return query(sql);
  });
  await expect(
    db.readSnapshot((reader) => reader.query("SELECT broken")),
  ).rejects.toBe(syntax);
  await db.end();
});
