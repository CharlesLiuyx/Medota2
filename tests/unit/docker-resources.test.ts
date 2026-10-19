import { resolve } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  lock: vi.fn(),
  release: vi.fn(),
}));
vi.mock("node:util", () => ({ promisify: () => mocks.execute }));
vi.mock("@/development/runtime", () => ({ acquireLock: mocks.lock }));
import {
  cleanupStoppedDockerResources,
  isStoppedWorkspaceContainer,
} from "@/development/docker-resources";

function container(
  root = process.cwd(),
  status = "exited",
  project = "medota2-local-review",
) {
  return {
    Id: "owned-container",
    State: { Status: status },
    Config: {
      Labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.service": "postgres",
        "com.docker.compose.project.working_dir": root,
        "com.docker.compose.project.config_files": resolve(
          root,
          "docker-compose.data-stack.yml",
        ),
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockResolvedValue(mocks.release);
});

it("only removes stopped containers with matching workspace, service and Compose file", () => {
  expect(isStoppedWorkspaceContainer(container())).toBe(true);
  expect(
    isStoppedWorkspaceContainer(container(resolve("../other-worktree"))),
  ).toBe(false);
  expect(isStoppedWorkspaceContainer(container(process.cwd(), "running"))).toBe(
    false,
  );
  expect(isStoppedWorkspaceContainer(container(process.cwd(), "created"))).toBe(
    false,
  );
  expect(
    isStoppedWorkspaceContainer(
      container(process.cwd(), "exited", "unrelated"),
    ),
  ).toBe(false);
  const foreign = container();
  foreign.Config.Labels["com.docker.compose.project.config_files"] =
    resolve("foreign.yml");
  expect(isStoppedWorkspaceContainer(foreign)).toBe(false);
});

it("cleans exact stopped containers and networks without force, volume or image deletion", async () => {
  mocks.execute.mockImplementation(async (_command, args) => ({
    stdout:
      args[0] === "ps"
        ? "owned-container\nforeign"
        : args[0] === "inspect"
          ? JSON.stringify([container(), container(resolve("../foreign"))])
          : args[0] === "network" && args[1] === "ls"
            ? "owned-network"
            : "",
  }));
  await cleanupStoppedDockerResources();
  const calls = mocks.execute.mock.calls.map(([, args]) => args);
  expect(calls).toContainEqual(["rm", "owned-container"]);
  expect(calls).toContainEqual(["network", "rm", "owned-network"]);
  expect(calls.filter((args) => args[0] === "rm")).toHaveLength(1);
  expect(JSON.stringify(calls)).not.toMatch(
    /--force|--volumes|"volume"|"prune"|"image"/,
  );
  expect(mocks.release).toHaveBeenCalledTimes(4);
});

it("does not touch Docker while another task owns a database or snapshot lock", async () => {
  mocks.lock
    .mockResolvedValueOnce(mocks.release)
    .mockRejectedValueOnce(new Error("database busy"));
  await expect(cleanupStoppedDockerResources()).rejects.toThrow(
    "database busy",
  );
  expect(mocks.execute).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});
