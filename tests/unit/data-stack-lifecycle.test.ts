import { describe, expect, it } from "vitest";
import {
  createDataStackPlan,
  destroyDataStack,
} from "@/server/environment/data-stack-lifecycle";

describe("data stack lifecycle", () => {
  it("assigns separate persistent projects, ports, volumes, and state roots", () => {
    const development = createDataStackPlan({
      environment: "development",
      workspaceRoot: "/workspace/medota2",
    });
    const localReview = createDataStackPlan({
      environment: "local-review",
      workspaceRoot: "/workspace/medota2",
    });

    expect(development).toMatchObject({
      composeProject: "medota2-development",
      hostPort: 54321,
      persistence: "persistent",
      stateDirectory: "/workspace/medota2/.medota2/environments/development",
    });
    expect(localReview).toMatchObject({
      composeProject: "medota2-local-review",
      hostPort: 54322,
      persistence: "persistent",
      stateDirectory: "/workspace/medota2/.medota2/environments/local-review",
    });
    expect(development.composeProject).not.toBe(localReview.composeProject);
    expect(development.hostPort).not.toBe(localReview.hostPort);
    expect(development.stateDirectory).not.toBe(localReview.stateDirectory);
  });

  it("allocates a run-scoped disposable test plan without a fixed port", () => {
    expect(
      createDataStackPlan({
        environment: "test",
        runId: "e2e-20260831-abcdef12",
        workspaceRoot: "/workspace/medota2",
      }),
    ).toMatchObject({
      composeProject: "medota2-test-e2e-20260831-abcdef12",
      hostPort: 0,
      persistence: "disposable",
      stateDirectory:
        "/workspace/medota2/.medota2/test-runs/e2e-20260831-abcdef12/state",
    });
  });

  it("requires a valid unique Run Identity for a test stack", () => {
    expect(() =>
      createDataStackPlan({
        environment: "test",
        runId: "shared_e2e",
        workspaceRoot: "/workspace/medota2",
      }),
    ).toThrow(/Run Identity/u);
  });

  it("refuses cleanup for a persistent or imprecise lease before invoking Docker", async () => {
    await expect(
      destroyDataStack({
        environment: "development",
        composeProject: "medota2-development",
        composeFile: "/workspace/medota2/docker-compose.data-stack.yml",
        hostPort: 54321,
        persistence: "persistent",
      }),
    ).rejects.toThrow(/exact test lease/u);
  });
});
