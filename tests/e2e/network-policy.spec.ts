import { expect, test } from "./test-fixture";

test("the browser adapter rejects non-loopback requests", async ({ page }) => {
  const response = await page.goto("/heroes");
  expect(response?.ok()).toBe(true);

  await expect(
    page.evaluate(async () => {
      await fetch("https://example.com/medota2-network-probe");
    }),
  ).rejects.toThrow();
});
