import { saveReceipt, stage, type PublicationReceipt } from "./receipt";

/** Side effects are explicit so failures and uncertain pushes can be exercised offline. */
export interface PublicationSteps {
  preflight(): Promise<void>;
  commit(): Promise<string>;
  prepareData(): Promise<string>;
  check(): Promise<void>;
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
  receipt.codeCommit = await stage(receipt, "commit-candidate", steps.commit);
  receipt.snapshotId = await stage(receipt, "prepare-data", steps.prepareData);
  await stage(receipt, "checks", steps.check);
  await stage(receipt, "candidate-guard", steps.assertCandidate);
  await stage(receipt, "remote-guard", steps.assertRemote);
  await stage(receipt, "publish-data", () =>
    steps.publishData(receipt.snapshotId!),
  );
  receipt.finalCommit = await stage(receipt, "finalize", steps.finalize);
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
