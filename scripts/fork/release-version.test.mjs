import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareCustomVersions, parseCustomVersion } from "./release-version.mjs";

test("identifies the upstream base separately from the custom revision", () => {
  assert.deepEqual(parseCustomVersion("v3.8.0-custom.1"), { version: "v3.8.0-custom.1", upstreamVersion: "v3.8.0", revision: 1 });
  assert.equal(parseCustomVersion("v3.9.1-custom.12").revision, 12);
});

for (const [candidate, current, expected] of [
  ["v3.8.0-custom.2", "v3.8.0-custom.1", 1],
  ["v3.8.0-custom.10", "v3.8.0-custom.9", 1],
  ["v3.8.1-custom.1", "v3.8.0-custom.99", 1],
  ["v3.10.0-custom.1", "v3.9.99-custom.99", 1],
  ["v4.0.0-custom.1", "v3.99.99-custom.99", 1],
  ["v3.8.0-custom.1", "v3.8.0-custom.1", 0],
  ["v3.8.0-custom.1", "v3.8.0-custom.2", -1],
  ["v3.8.0-custom.99", "v3.8.1-custom.1", -1],
]) {
  test(`orders ${candidate} against ${current}`, () => assert.equal(compareCustomVersions(candidate, current), expected));
}

test("comparison rejects unknown current versions", () => assert.throws(() => compareCustomVersions("v3.8.0-custom.2", "dev")));

for (const value of [
  "v3.8.0",
  "v3.8.0.1",
  "3.8.0-custom.1",
  "v3.8.0-custom.0",
  "v3.8.0-custom.01",
  "v03.8.0-custom.1",
  "v3.08.0-custom.1",
  "v3.8.00-custom.1",
  "v3.8.0-custom.1.2",
  "v3.8.0-custom.1\n",
  "v3.8.0-custom.1+build",
  "v3.8.0-beta.1",
  "v3.8.0-custom.9007199254740992",
  "v9007199254740992.8.0-custom.1",
  "",
  null,
]) {
  test(`rejects invalid release label ${JSON.stringify(value)}`, () => assert.throws(() => parseCustomVersion(value)));
}

test("the workflow CLI fails closed and emits only a validated tag", () => {
  const script = fileURLToPath(new URL("./release-version.mjs", import.meta.url));
  const valid = spawnSync(process.execPath, [script, "v3.8.0-custom.1"], { encoding: "utf8" });
  assert.equal(valid.status, 0);
  assert.equal(valid.stdout.trim(), "v3.8.0-custom.1");
  for (const args of [[], ["v3.8.0.1"], ["v3.8.0-custom.1\n"], ["v3.8.0-custom.1", "extra"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
  }
});
