import { expect, test } from "./test-fixture";
import {
  deleteImportFailureFixture,
  insertImportFailureFixture,
} from "../helpers/import-failure-fixture";

let failureRunId: string | undefined;

test.beforeEach(async () => {
  failureRunId = await insertImportFailureFixture();
});

test.afterEach(async () => {
  if (!failureRunId) return;
  await deleteImportFailureFixture(failureRunId);
  failureRunId = undefined;
});

test("a failed import is reported without replacing the active catalog", async ({
  page,
}) => {
  await page.goto("/heroes");
  await expect(
    page.getByText("最近一次 VPK 导入失败", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "敌法师" })).toBeVisible();
  await expect(
    page.getByText("Fixture failure kept the previous active dataset."),
  ).toBeVisible();
});
