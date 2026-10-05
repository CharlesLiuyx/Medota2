import { runCatalogSample } from "@/development/sample";

runCatalogSample(process.argv[2])
  .then((result) => {
    if (process.send) process.send({ result });
    else console.log(JSON.stringify(result));
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (process.send) process.send({ error: message });
    else console.error(message);
    process.exitCode = 1;
  });
