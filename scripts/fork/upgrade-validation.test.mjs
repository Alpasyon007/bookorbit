import assert from "node:assert/strict";
import { test } from "node:test";
import { validateUpgradeIdentity, validateUpgradeState } from "./upgrade-validation.mjs";
test("upgrade identity rejects an untested image or missing version", () => {
  assert.throws(() => validateUpgradeIdentity("upstream:latest", "v3.9.0-custom.1"));
  assert.throws(() => validateUpgradeIdentity(`bookorbit-checked:${"a".repeat(40)}`, ""));
  validateUpgradeIdentity(`bookorbit-checked:${"a".repeat(40)}`, "v3.9.0-custom.1");
});
test("upgrade rejects dropped fixtures, missing migrations and repeated migrations", () => {
  const fixture = '{"synthetic":"retained"}';
  assert.throws(() => validateUpgradeState(fixture, "{}", 143, 162));
  assert.throws(() => validateUpgradeState(fixture, fixture, 143, 143));
  assert.throws(() => validateUpgradeState(fixture, fixture, 162, 163, true));
  validateUpgradeState(fixture, fixture, 143, 162);
  validateUpgradeState(fixture, fixture, 162, 162, true);
});

test("upgrade runner can be imported without running Docker", async () => {
  const { upgradeImage } = await import("./upgrade-image.mjs");
  assert.equal(typeof upgradeImage, "function");
});
