import { expect, test } from "../e2e/test-fixture";

test("map: default overlays and complete camp hover previews", async ({
  page,
  request,
}, testInfo) => {
  const response = await request.get("/api/releases");
  const index = await response.json();
  const release = index.releases.find(
    (entry: { mapId: string | null; patch: string }) =>
      entry.mapId && entry.patch === "7.41f",
  );
  test.skip(!release, "This fixture has no native map Dataset.");
  await page.goto(`/map?lang=en&release=${encodeURIComponent(release.id)}`);
  for (const name of ["Camp gold", "Camp XP", "Pull/stack timings"])
    await expect(
      page.getByRole("checkbox", { name, exact: true }),
    ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Lane paths", exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Currents", exact: true }),
  ).not.toBeChecked();
  const table = page.getByRole("table", {
    name: "Gold and experience by camp",
  });
  await table.getByRole("button").first().click();
  await page.getByRole("button", { name: "Close point details" }).click();
  const canvas = page.locator("canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const builds = await canvas.getAttribute("data-background-builds");
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const sidebar = page.getByRole("complementary", {
    name: "Selected object properties and controls",
  });
  const preview = sidebar.getByRole("region", {
    name: "Camp composition details",
  });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(/Gold \d/);
  await expect(preview).toContainText(/XP \d/);
  await expect(preview).toContainText("Stack at");
  await expect(preview).toContainText("Spawn X");
  await expect(preview).toContainText("Z range:");
  await expect(preview).toContainText("×");
  await expect(canvas).toHaveAttribute("data-background-builds", builds!);
  await page.screenshot({ path: testInfo.outputPath("camp-hover-en.png") });
  const hoverContents = await preview.textContent();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.move(rect.x + 5, rect.y + 5);
  await expect(preview).toBeVisible();
  await expect(preview).toHaveText(hoverContents!);
  await page.screenshot({ path: testInfo.outputPath("camp-selected-en.png") });
  await page.getByRole("button", { name: "Close point details" }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole("button", { name: "Vision", exact: true }).click();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Vision simulation", exact: true }),
  ).toHaveAttribute("data-vision-preview", /^cursor:/);
  await expect(canvas).toHaveAttribute("data-high-ground", "visible");
  const visionBuilds = await canvas.getAttribute("data-background-builds");
  await canvas.press("Escape");
  await page.mouse.move(rect.x + rect.width / 2 + 1, rect.y + rect.height / 2);
  await expect(preview).toBeVisible();
  await page.mouse.move(rect.x + 5, rect.y + 5);
  await expect(preview).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-background-builds", visionBuilds!);
});
