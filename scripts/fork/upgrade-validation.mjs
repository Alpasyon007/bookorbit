import assert from "node:assert/strict";
export function validateUpgradeIdentity(image, version) {
  assert.ok(/^bookorbit-checked:[a-f0-9]{40}$/.test(image ?? ""), "Upgrade requires the exact checked image");
  assert.ok(/^(?:v[0-9]+\.[0-9]+\.[0-9]+-custom\.[1-9][0-9]*|sha-[a-f0-9]{40})$/.test(version ?? ""), "Upgrade requires the expected build version");
}
export function validateUpgradeState(before, after, oldCount, count, restarting = false) {
  assert.ok(typeof before === "string" && before.length > 10, "Fixture snapshot is required");
  assert.ok(before === after, "Upgrade must preserve every synthetic fixture");
  assert.ok(Number.isSafeInteger(oldCount) && oldCount > 0 && Number.isSafeInteger(count), "Migration counts must be valid");
  assert.ok(restarting ? count === oldCount : count > oldCount, "Unexpected migration ledger after upgrade or restart");
}
