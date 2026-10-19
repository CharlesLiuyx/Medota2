import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { acquireLock } from "./runtime";

const execute = promisify(execFile);
interface Container {
  Id: string;
  State: { Status: string };
  Config: { Labels: Record<string, string> };
}

/** Names alone are insufficient: require Compose's exact checkout and config. */
export function isStoppedWorkspaceContainer(
  container: Container,
  root = process.cwd(),
): boolean {
  const labels = container.Config.Labels;
  const project = labels["com.docker.compose.project"] ?? "";
  const file = labels["com.docker.compose.project.config_files"];
  return (
    ["exited", "dead"].includes(container.State.Status) &&
    labels["com.docker.compose.project.working_dir"] === resolve(root) &&
    labels["com.docker.compose.service"] === "postgres" &&
    ((["medota2-development", "medota2-local-review"].includes(project) &&
      file === resolve(root, "docker-compose.data-stack.yml")) ||
      (/^medota2-sync-[a-f0-9-]{36}$/.test(project) &&
        file === resolve(root, "docker-compose.data-stack.yml")) ||
      (/^medota2-test-[a-z0-9][a-z0-9-]{7,62}$/.test(project) &&
        file === resolve(root, "docker-compose.test-run.yml")) ||
      (project === "medota2" && file === resolve(root, "docker-compose.yml")))
  );
}

/** Reconcile leftovers after Docker/host interruption. Never delete volumes or images. */
export async function cleanupStoppedDockerResources(): Promise<void> {
  const releases: Array<() => Promise<void>> = [];
  try {
    // Do not race a provision, snapshot switch, or active fixture lease.
    for (const name of [
      "data-sync",
      "development-database",
      "local-review-database",
      "test-database",
    ])
      releases.push(await acquireLock(name, 0));
    const ids = (
      await execute("docker", [
        "ps",
        "-aq",
        "--filter",
        "label=com.docker.compose.project",
      ])
    ).stdout
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length) return;
    const containers = JSON.parse(
      (
        await execute("docker", ["inspect", ...ids], {
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout,
    ) as Container[];
    for (const container of containers.filter((item) =>
      isStoppedWorkspaceContainer(item),
    )) {
      // No --force: a container restarted since inspection must not be killed.
      await execute("docker", ["rm", container.Id]);
      const project = container.Config.Labels["com.docker.compose.project"];
      const networks = (
        await execute("docker", [
          "network",
          "ls",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${project}`,
        ])
      ).stdout
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (const network of networks) {
        // Docker refuses a network with active endpoints; never force removal.
        await execute("docker", ["network", "rm", network]);
      }
      console.log(
        `[cleanup] Removed stopped ${project}; database volumes retained.`,
      );
    }
  } finally {
    for (const release of releases.reverse()) await release();
  }
}
