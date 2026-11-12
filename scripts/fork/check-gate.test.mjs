import assert from "node:assert/strict";
import { test } from "node:test";
import { assertChecksPassed } from "./check-gate.mjs";

const successful = () => Object.fromEntries(["context", "verify", "e2e", "image"].map((name) => [name, { result: "success" }]));

test("allows publishing only when every required check succeeded", () => {
  assert.doesNotThrow(() => assertChecksPassed(successful()));
});

for (const job of ["context", "verify", "e2e", "image"]) {
  for (const result of ["failure", "cancelled", "skipped", "", undefined]) {
    test(`blocks ${job} with result ${String(result)}`, () => {
      const results = successful();
      results[job].result = result;
      assert.throws(() => assertChecksPassed(results));
    });
  }
  test(`blocks missing ${job}`, () => {
    const results = successful();
    delete results[job];
    assert.throws(() => assertChecksPassed(results));
  });
}

test("blocks absent check results", () => {
  assert.throws(() => assertChecksPassed(null));
});
