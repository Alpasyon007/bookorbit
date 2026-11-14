import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { ukMetadataImageTag } from "./uk-metadata-version.mjs";

const providers = ["hachette-uk", "waterstones", "foyles"];

async function smoke({ baseUrl, expectedVersion, authToken }) {
  const url = new URL(baseUrl);
  assert.ok(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.href === `${url.origin}/`, "A loopback origin is required");
  ukMetadataImageTag(expectedVersion);
  assert.ok(typeof authToken === "string" && authToken.length > 0, "A disposable provider token is required");

  function request(path, authorize = false) {
    return fetch(new URL(path, url), {
      headers: authorize ? { Authorization: `Bearer ${authToken}` } : {},
      signal: AbortSignal.timeout(3_000),
      redirect: "error",
    });
  }

  const end = Date.now() + 30_000;
  let health;
  while (Date.now() < end) {
    const response = await request("/health").catch(() => undefined);
    if (response?.ok) {
      health = await response.json();
      break;
    }
    await response?.body?.cancel();
    await sleep(250);
  }
  assert.deepEqual(health, { status: "ok" }, "Provider health did not report ready");

  for (const key of providers) {
    const unauthenticated = await request(`/${key}/provider/info`);
    assert.equal(unauthenticated.status, 401, `${key} must require its configured token`);
    await unauthenticated.body?.cancel();

    const info = await request(`/${key}/provider/info`, true);
    assert.equal(info.status, 200, `${key} must advertise its provider information`);
    const data = await info.json();
    assert.equal(data.key, key);
    assert.equal(data.version, expectedVersion);
    assert.ok(data.mediaTypes.includes("book"));
    assert.ok(data.supportedFields.includes("cover"));

    const search = await request(`/${key}/search?query=Dune&mediaType=audiobook`, true);
    assert.equal(search.status, 200);
    assert.deepEqual((await search.json()).matches, []);
  }
}

try {
  await smoke({ baseUrl: process.env.PROVIDER_URL, expectedVersion: process.env.EXPECTED_VERSION, authToken: process.env.AUTH_TOKEN });
  console.log("UK metadata provider production smoke passed");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
