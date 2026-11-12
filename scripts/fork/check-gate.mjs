import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export function assertChecksPassed(results) {
  for (const job of ["context", "verify", "e2e", "image"]) {
    assert.equal(results?.[job]?.result, "success", `Required check ${job} did not succeed`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertChecksPassed(JSON.parse(process.env.CHECK_RESULTS ?? "null"));
  console.log("All required fork checks passed.");
}
