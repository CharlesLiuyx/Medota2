import { createServer } from "node:http";
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

test.describe("API probe connection isolation", () => {
  test.use({ extraHTTPHeaders: { "x-fixture-probe": "preserved" } });

  test("API probes close each connection and preserve configured headers", async ({
    request,
  }) => {
    const sockets = new Set<unknown>();
    const server = createServer((incoming, response) => {
      sockets.add(incoming.socket);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          connection: incoming.headers.connection,
          custom: incoming.headers["x-fixture-probe"],
        }),
      );
    });
    await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing probe port");
      for (let index = 0; index < 2; index++) {
        const response = await request.get(
          `http://127.0.0.1:${address.port}/probe`,
        );
        expect(response.ok()).toBe(true);
        expect(await response.json()).toEqual({
          connection: "close",
          custom: "preserved",
        });
      }
      expect(sockets.size).toBe(2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    }
  });
});
