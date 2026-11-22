import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { validateUpgradeIdentity, validateUpgradeState } from "./upgrade-validation.mjs";
import { smokeImage } from "./smoke-image.mjs";

export async function upgradeImage() {
  const previous = "ghcr.io/alpasyon007/bookorbit@sha256:51ad3521634ddf024a6731a60e87b358e616495047273752a5fda3c3e9b77521";
  const image = process.env.IMAGE;
  const version = process.env.FORK_SMOKE_VERSION;
  validateUpgradeIdentity(image, version);
  const database = "postgres://bookorbit:bookorbit@127.0.0.1:5432/bookorbit_upgrade";
  const name = "bookorbit-fork-upgrade";
  const baseUrl = "http://127.0.0.1:3001";
  let token;
  const preferences = {
    version: 1,
    seriesGrid: {
      enabled: true,
      hierarchyOrder: "reverse",
      groupOrder: "name-desc",
      maxDepth: 3,
      directBooksPosition: "first",
      standalonePosition: "first",
      standaloneLabel: "Unassigned",
      headingIndent: 2,
      showDividers: false,
    },
    sidebar: { enabled: true, showGithub: true, showSupport: false, showIos: false, showAndroid: false },
    seriesRequests: { enabled: true, defaultFormat: "audiobook", initialSelection: "none", showRequestAll: false },
    coverSearch: { enabled: false },
  };
  const policy = {
    version: 1,
    seriesGridEnabled: true,
    sidebarCustomizationEnabled: true,
    seriesRequestsEnabled: false,
    extendedCoverSearchEnabled: true,
  };
  async function api(path, body) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method: body ? "PUT" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body ? JSON.stringify({ settings: body }) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    assert.ok(response.ok, `Upgrade API check failed: ${path}`);
    return response.status === 204 ? null : response.json();
  }
  async function checkApi() {
    assert.ok((await api("/auth/me")).username === "fork-smoke-admin", "Upgraded session must remain usable");
    assert.ok((await api("/app-info")).version === version, "Upgraded app version must match the checked image");
    assert.ok(
      isDeepStrictEqual((await api("/custom-patches/preferences")).settings, preferences),
      "Saved preferences must remain valid through the API",
    );
    assert.ok(isDeepStrictEqual((await api("/custom-patches/policy")).settings, policy), "Saved policy must remain valid through the API");
  }
  const setupToken = "fork-upgrade-disposable-token";
  const docker = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024 }).trim();
  const sql = (query, db = database) =>
    docker(["run", "--rm", "--network", "host", "-i", "pgvector/pgvector:pg18", "psql", db, "-X", "-v", "ON_ERROR_STOP=1", "-At"], query);
  let containerCreated = false;
  const remove = () => {
    if (!containerCreated) return;
    try {
      docker(["rm", "--force", "--volumes", name]);
      containerCreated = false;
    } catch {}
  };
  function start(reference) {
    docker([
      "run",
      "--detach",
      "--name",
      name,
      "--network",
      "host",
      "-e",
      `DATABASE_URL=${database}`,
      "-e",
      "PORT=3001",
      "-e",
      "JWT_SECRET=fork-upgrade-disposable-secret",
      "-e",
      "JWT_EXPIRES_IN=1h",
      "-e",
      `SETUP_BOOTSTRAP_TOKEN=${setupToken}`,
      "-e",
      `APP_URL=${baseUrl}`,
      "-e",
      `CLIENT_URL=${baseUrl}`,
      reference,
    ]);
    containerCreated = true;
  }
  async function ready() {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(5000) });
        const health = await response.json();
        if (response.ok && health.status === "ok" && health.details?.database?.status === "up") return;
      } catch {}
      await sleep(2000);
    }
    throw new Error("Upgraded container did not become healthy");
  }
  const snapshot = () =>
    sql(
      `SELECT json_build_object('users', (SELECT json_agg(json_build_object('id',id,'username',username,'password_hash',password_hash,'active',active,'is_superuser',is_superuser) ORDER BY id) FROM users), 'libraries', (SELECT json_agg(json_build_object('id',id,'name',name,'watch',watch) ORDER BY id) FROM libraries), 'books', (SELECT json_agg(json_build_object('id',id,'library_id',library_id,'library_folder_id',library_folder_id,'folder_path',folder_path) ORDER BY id) FROM books), 'series', (SELECT json_agg(json_build_object('id',id,'name',name,'normalized_name',normalized_name) ORDER BY id) FROM book_series), 'memberships', (SELECT json_agg(json_build_object('book_id',book_id,'series_id',series_id,'series_index',series_index,'display_order',display_order) ORDER BY book_id,display_order) FROM book_series_memberships), 'policy', (SELECT value FROM app_settings WHERE key='fork.custom-patches.policy.v1'), 'providers', (SELECT json_agg(json_build_object('key',key,'base_url',base_url,'enabled',enabled,'allow_private_address',allow_private_address) ORDER BY id) FROM metadata_http_providers), 'metadata', (SELECT json_agg(json_build_object('book_id',book_id,'title',title,'language',language) ORDER BY book_id) FROM book_metadata), 'preferences', (SELECT json_agg(json_build_object('user_id',user_id,'category',category,'data',data) ORDER BY user_id,category) FROM user_preferences));`,
    );
  assert.equal(docker(["ps", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"]), "", "Upgrade container name is already in use");
  try {
    sql("CREATE DATABASE bookorbit_upgrade;", "postgres://bookorbit:bookorbit@127.0.0.1:5432/bookorbit_smoke");
    docker(["run", "--rm", "--network", "host", "-e", `DATABASE_URL=${database}`, "--entrypoint", "node", previous, "dist/scripts/migrate.js"]);
    sql("INSERT INTO app_settings(key,value) VALUES ('update_check_enabled','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value;");
    start(previous);
    await smokeImage({
      baseUrl,
      expectedVersion: "v3.8.0-custom.11",
      setupToken,
      onAuthenticated: async (auth) => {
        token = auth.token;
        await api("/custom-patches/preferences", preferences);
        await api("/custom-patches/policy", policy);
      },
    });
    remove();
    sql(
      `INSERT INTO libraries(name,watch) VALUES ('Fork upgrade fixture',false); INSERT INTO library_folders(library_id,path) SELECT id,'/books/fork-upgrade' FROM libraries WHERE name='Fork upgrade fixture'; INSERT INTO books(library_id,library_folder_id,folder_path) SELECT library_id,id,'/books/fork-upgrade/book' FROM library_folders WHERE path='/books/fork-upgrade'; INSERT INTO book_series(name,normalized_name) VALUES ('Upgrade series','upgrade series'); INSERT INTO book_series_memberships(book_id,series_id,series_index,display_order) SELECT b.id,s.id,'1.5',0 FROM books b CROSS JOIN book_series s WHERE b.folder_path='/books/fork-upgrade/book' AND s.normalized_name='upgrade series'; INSERT INTO book_metadata(book_id,title,language) SELECT id,'Synthetic upgrade book','en' FROM books; INSERT INTO metadata_http_providers(key,base_url,enabled,allow_private_address) VALUES ('upgrade-fixture','http://127.0.0.1:9',false,true);`,
    );
    assert.equal(
      sql(
        "SELECT concat((SELECT count(*) FROM users),',',(SELECT count(*) FROM libraries),',',(SELECT count(*) FROM books),',',(SELECT count(*) FROM book_series_memberships),',',(SELECT count(*) FROM metadata_http_providers));",
      ),
      "1,1,1,1,1",
      "Synthetic fixture counts must match",
    );
    const before = snapshot();
    const oldCount = Number(sql("SELECT count(*) FROM drizzle.__drizzle_migrations;"));
    start(image);
    await ready();
    await checkApi();
    const count = Number(sql("SELECT count(*) FROM drizzle.__drizzle_migrations;"));
    validateUpgradeState(before, snapshot(), oldCount, count);
    remove();
    start(image);
    await ready();
    await checkApi();
    validateUpgradeState(before, snapshot(), count, Number(sql("SELECT count(*) FROM drizzle.__drizzle_migrations;")), true);
    console.log("Previous custom.11 image upgrade and idempotent restart passed with synthetic fixtures");
  } catch (error) {
    try {
      if (containerCreated) console.error(docker(["logs", "--tail", "100", name]));
    } catch {}
    throw error;
  } finally {
    remove();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await upgradeImage();
