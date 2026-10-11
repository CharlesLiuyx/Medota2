import { saveReceipt, stage, type PublicationReceipt } from "./receipt";

/** Side effects are explicit so failures and uncertain pushes can be exercised offline. */
export interface PublicationSteps {
  preflight(): Promise<void>;
  staticCheck(): Promise<void>;
  commit(): Promise<string>;
  prepareData(): Promise<string>;
  check(signal: AbortSignal): Promise<void>;
  // Present only for unchanged snapshots; checks the immutable code commit on a candidate branch.
  candidateCI?(
    sha: string,
    snapshotId: string,
    signal: AbortSignal,
    fail: (error: unknown) => void,
  ): Promise<string | undefined>;
  assertCandidate(): Promise<void>;
  publishData(snapshotId: string): Promise<void>;
  finalize(): Promise<string>;
  assertRemote(): Promise<void>;
  push(sha: string): Promise<void>;
  remoteContains(sha: string): Promise<boolean>;
  confirmCI(sha: string): Promise<string>;
}
export async function publishCandidate(
  receipt: PublicationReceipt,
  steps: PublicationSteps,
) {
  await stage(receipt, "preflight", steps.preflight);
  await stage(receipt, "static-preflight", steps.staticCheck);
  receipt.codeCommit = await stage(receipt, "commit-candidate", steps.commit);
  receipt.snapshotId = await stage(receipt, "prepare-data", steps.prepareData);
  const controller = new AbortController();
  let failure: unknown;
  const fail = (error: unknown) => {
    if (!controller.signal.aborted) {
      failure = error;
      controller.abort(error);
    }
  };
  // Cancel peers at the first failure, then JOIN cleanup before touching data or returning.
  const gate = <T>(name: string, work: () => Promise<T>) =>
    stage(receipt, name, async () => {
      try {
        controller.signal.throwIfAborted();
        return await work();
      } catch (error) {
        fail(error);
        throw error;
      }
    });
  const outcomes = await Promise.allSettled([
    gate("checks", () => steps.check(controller.signal)),
    ...(steps.candidateCI
      ? [
          gate("candidate-ci", () =>
            steps.candidateCI!(
              receipt.codeCommit!,
              receipt.snapshotId!,
              controller.signal,
              fail,
            ),
          ),
        ]
      : []),
  ]);
  if (controller.signal.aborted) throw failure;
  for (const result of outcomes)
    if (result.status === "rejected") throw result.reason;
  const candidateCI = outcomes[1];
  if (candidateCI?.status === "fulfilled")
    receipt.candidateCIUrl = candidateCI.value as string | undefined;
  await stage(receipt, "candidate-guard", steps.assertCandidate);
  await stage(receipt, "remote-guard", steps.assertRemote);
  await stage(receipt, "publish-data", () =>
    steps.publishData(receipt.snapshotId!),
  );
  receipt.finalCommit = await stage(receipt, "finalize", steps.finalize);
  await stage(receipt, "promotion-guard", async () => {
    if (receipt.candidateCIUrl && receipt.finalCommit !== receipt.codeCommit)
      throw new Error("候选CI提交与最终提交不同；重新规划发布，不能复用旧CI。");
  });
  // Save the exact target BEFORE pushing: a killed client can recover by reading the remote.
  await saveReceipt(receipt);
  await stage(receipt, "push-code", async () => {
    await steps.assertRemote();
    try {
      await steps.push(receipt.finalCommit!);
    } catch (error) {
      if (!(await steps.remoteContains(receipt.finalCommit!))) throw error;
    }
    if (!(await steps.remoteContains(receipt.finalCommit!)))
      throw new Error("远端提交与发布候选不同，请核对分支并发更新。");
  });
  receipt.status = "published";
  await saveReceipt(receipt);
  await confirmPublication(receipt, steps);
}
export async function confirmPublication(
  receipt: PublicationReceipt,
  steps: Pick<PublicationSteps, "remoteContains" | "confirmCI">,
) {
  const sha = receipt.finalCommit;
  await stage(receipt, "confirm-remote", async () => {
    if (!sha || !(await steps.remoteContains(sha)))
      throw new Error(
        "远端未指向收据中的最终提交；不能使用此收据续接CI。请重新核对发布范围。",
      );
  });
  receipt.ciUrl = await stage(receipt, "confirm-ci", async () => {
    const url = await steps.confirmCI(sha!);
    if (!(await steps.remoteContains(sha!)))
      throw new Error("CI期间远端已变化；此候选通过不能代表远端新版本通过。");
    return url;
  });
  receipt.status = "passed";
  await saveReceipt(receipt);
  console.log(
    `[push] passed: ${sha}, snapshot ${receipt.snapshotId}, ${receipt.ciUrl}`,
  );
}
