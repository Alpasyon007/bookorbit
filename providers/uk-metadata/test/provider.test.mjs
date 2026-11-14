import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { isbn13, readCover } from "../book.mjs";
import { parseHachetteProduct } from "../hachette.mjs";
import { createMetadataServer } from "../server.mjs";
import { createUpstream, SourceError } from "../upstream.mjs";

const fixture = (name) => readFile(new URL(`fixtures/${name}`, import.meta.url), "utf8");
const hachetteSearch = await fixture("hachette-fifth-season-search.html");
const hachetteProduct = await fixture("hachette-fifth-season.html");
const fifthEdition = JSON.parse(await fixture("open-library-fifth-season.json"));
const poppy = JSON.parse(await fixture("open-library-poppy-war.json"));
const placeholder = Buffer.from(await fixture("retailer-placeholder.base64"), "base64");
const picture = await sharp({ create: { width: 318, height: 500, channels: 3, background: "#a04533" } })
  .jpeg()
  .toBuffer();

const FIFTH = "9780356508191";
const POPPY = "9780008239848";
const missingIsbn = "9780000000002";
const productUrl = new URL("https://www.hachette.co.uk/titles/n-k-jemisin/the-fifth-season/9780356508191/");
const noResults = '<html><body class="search search-no-results"></body></html>';

function html(content, status = 200) {
  return new Response(content, { status, headers: { "Content-Type": "text/html; charset=UTF-8" } });
}

function image(bytes = picture, mime = "image/jpeg", status = 200) {
  return new Response(bytes, { status, headers: { "Content-Type": mime } });
}

function stub(url) {
  if (url.origin === "https://www.hachette.co.uk") {
    if (url.pathname === "/") {
      const query = url.searchParams.get("s");
      if (query === FIFTH) return Response.redirect(productUrl, 302);
      if (query === "The Fifth Season") return html(hachetteSearch);
      return html(noResults);
    }
    if (url.pathname === productUrl.pathname) return html(hachetteProduct);
    if (url.pathname.startsWith("/wp-content/uploads/")) return image();
  }
  if (url.origin === "https://openlibrary.org") {
    if (url.pathname === "/search.json") {
      const isbn = url.searchParams.get("isbn");
      if (isbn) return Response.json(isbn === FIFTH ? fifthEdition : { docs: [] });
      return Response.json({ docs: poppy.docs });
    }
    if (url.pathname === "/works/OL19351054W/editions.json") return Response.json({ entries: poppy.entries });
  }
  if (/^cdn\.(waterstones\.com|foyles\.co\.uk)$/.test(url.hostname)) return image();
  throw new Error("Unexpected upstream request");
}

async function start(t, override = () => {}, options = {}) {
  const seen = [];
  const log = [];
  const server = createMetadataServer({
    ...options,
    fetcher: (url, request) => {
      seen.push(new URL(url));
      return override(url, request) ?? stub(url);
    },
    logger: { info: (line) => log.push(line), warn: (line) => log.push(line) },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    seen,
    log,
    async get(path, headers) {
      const response = await fetch(`${base}${path}`, { headers });
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
  };
}

const search = (key, params) => `/${key}/search?${new URLSearchParams(params)}`;

test("normalizes ISBN-10 and verifies the ISBN-13 check digit", () => {
  assert.equal(isbn13("0-356-50819-6"), FIFTH);
  assert.equal(isbn13("978-0-356-50819-1"), FIFTH);
  assert.equal(isbn13("9780356508190"), undefined);
  assert.equal(isbn13("035650819X"), undefined);
});

test("serves three distinct native contracts and optionally requires bearer authentication", async (t) => {
  const { get, seen } = await start(t, undefined, { authToken: "local-test-token" });
  assert.deepEqual((await get("/health")).body, { status: "ok" });
  for (const key of ["hachette-uk", "waterstones", "foyles"]) {
    assert.equal((await get(`/${key}/provider/info`)).status, 401);
    const headers = { Authorization: "Bearer local-test-token" };
    const { status, body } = await get(`/${key}/provider/info`, headers);
    assert.equal(status, 200);
    assert.equal(body.key, key);
    assert.equal(body.version, "0.1.0");
    assert.equal(body.authenticationRequired, true);
    assert.deepEqual(body.mediaTypes, ["book"]);
    assert.ok(body.supportedFields.includes("cover"));
    assert.deepEqual(body.searchParams, ["query", "author", "mediaType", "isbn", "limit"]);
    assert.deepEqual((await get(search(key, { query: "Dune", mediaType: "audiobook" }), headers)).body, { matches: [] });
    assert.equal((await get(search(key, { isbn: "9780356508190" }), headers)).status, 400);
  }
  assert.equal(seen.length, 0);
});

test("Hachette title search checks the right contributor and returns verified publisher artwork", async (t) => {
  const { get, seen, log } = await start(t);
  const path = search("hachette-uk", { query: "The Fifth Season", author: "N. K. Jemisin" });
  const found = await get(path);
  assert.equal(found.status, 200);
  assert.equal(found.body.matches.length, 1);
  const [match] = found.body.matches;
  assert.equal(match.providerId, FIFTH);
  assert.equal(match.title, "The Fifth Season");
  assert.deepEqual(match.authors, ["N. K. Jemisin"]);
  assert.equal(new URL(match.cover).origin, "https://www.hachette.co.uk");
  assert.equal(match.coverWidth, 318);
  assert.equal(match.coverHeight, 500);
  assert.ok(seen.every((url) => !url.pathname.includes("mons-kallentoft")));
  const requests = seen.length;
  assert.deepEqual((await get(path)).body, found.body);
  assert.equal(seen.length, requests);
  assert.deepEqual((await get(search("hachette-uk", { query: "The Fifth Season", author: "Other Author" }))).body, { matches: [] });
  assert.deepEqual((await get(search("hachette-uk", { query: "No such book" }))).body, { matches: [] });
  assert.ok(log.every((line) => !line.includes(FIFTH) && !line.includes("The Fifth Season")));
});

test("Hachette follows only the exact edition redirect and distinguishes missing books", async (t) => {
  const { get, seen } = await start(t);
  assert.equal((await get(`/hachette-uk/book/${FIFTH}`)).body.providerId, FIFTH);
  assert.equal((await get(`/hachette-uk/book/${missingIsbn}`)).status, 404);
  assert.equal(seen[0].searchParams.get("s"), FIFTH);
  assert.equal(seen[1].href, productUrl.href);
  const rejected = await start(t, (url) => (url.pathname === "/" ? Response.redirect("http://127.0.0.1/elsewhere", 302) : undefined));
  assert.equal((await rejected.get(`/hachette-uk/book/${FIFTH}`)).status, 502);
  assert.equal(rejected.seen.length, 1);
});

test("Hachette JSON-LD cannot cross an edition or artwork origin", () => {
  assert.equal(parseHachetteProduct(hachetteProduct.replace(FIFTH, "9781444776317"), productUrl), undefined);
  const content = hachetteProduct.replace("https://www.hachette.co.uk/wp-content/", "https://example.com/wp-content/");
  assert.equal(parseHachetteProduct(content, productUrl).image, undefined);
});

test("both retailer providers return actual jacket URLs with their Open Library edition metadata", async (t) => {
  const { get, seen } = await start(t);
  for (const [key, host] of [
    ["waterstones", "cdn.waterstones.com"],
    ["foyles", "cdn.foyles.co.uk"],
  ]) {
    const byTitle = await get(search(key, { query: "The Poppy War", author: "R. F. Kuang", limit: "1" }));
    assert.equal(byTitle.status, 200);
    assert.equal(byTitle.body.matches.length, 1);
    const [match] = byTitle.body.matches;
    assert.equal(match.providerId, POPPY);
    assert.equal(match.publisher, "Harper Voyager");
    assert.equal(match.cover, `https://${host}/bookjackets/large/9780/0082/${POPPY}.jpg`);
    assert.equal(match.url, "https://openlibrary.org/books/OL28688483M");
    const exact = await get(search(key, { isbn: "0356508196" }));
    const lookup = await get(`/${key}/book/${FIFTH}`);
    assert.equal(exact.body.matches[0].providerId, FIFTH);
    assert.deepEqual(exact.body.matches[0], lookup.body);
    assert.equal(new URL(lookup.body.cover).host, host);
  }
  assert.equal(seen.filter((url) => url.origin === "https://openlibrary.org").length, 3);
  assert.ok(seen.filter((url) => url.hostname.startsWith("cdn.")).every((url) => !url.search));
  assert.deepEqual((await get(search("foyles", { query: "The Poppy War", author: "Wrong Author" }))).body, { matches: [] });
  assert.deepEqual((await get(search("foyles", { query: "Wrong title", author: "R. F. Kuang" }))).body, { matches: [] });
});

test("rejects 200 jacket placeholders, 404 jacket images and unknown ISBNs", async (t) => {
  const { get, seen } = await start(t, (url) => {
    if (url.hostname === "cdn.waterstones.com") return image(placeholder, "image/webp");
    if (url.hostname === "cdn.foyles.co.uk") return image(picture, "image/png", 404);
  });
  for (const key of ["waterstones", "foyles"]) {
    assert.deepEqual((await get(search(key, { isbn: FIFTH }))).body, { matches: [] });
    assert.equal((await get(`/${key}/book/${FIFTH}`)).status, 404);
  }
  const knownImages = seen.filter((url) => url.hostname.startsWith("cdn.")).length;
  assert.deepEqual((await get(search("foyles", { isbn: missingIsbn }))).body, { matches: [] });
  assert.equal(seen.filter((url) => url.hostname.startsWith("cdn.")).length, knownImages);
});

test("rejects an unrecognized page, invalid image and upstream authentication challenge as failures", async (t) => {
  const { get, log } = await start(t, (url) => {
    if (url.hostname === "www.hachette.co.uk") return html("<html><body>Please verify your browser</body></html>");
    if (url.hostname === "cdn.waterstones.com") return image(Buffer.from("not a JPEG"));
    if (url.hostname === "cdn.foyles.co.uk") return new Response("Blocked", { status: 403 });
  });
  assert.equal((await get(search("hachette-uk", { query: "The Fifth Season" }))).status, 502);
  assert.equal((await get(search("waterstones", { isbn: FIFTH }))).status, 502);
  assert.equal((await get(search("foyles", { isbn: FIFTH }))).status, 502);
  assert.ok(log.some((line) => line.includes("[fail]")));
  assert.ok(log.every((line) => !line.includes("Blocked") && !line.includes(FIFTH)));
});

test("reports throttling, partial provider results and oversized upstream responses truthfully", async (t) => {
  let blocked = 0;
  const app = await start(t, (url) => {
    if (url.hostname === "cdn.waterstones.com") {
      blocked++;
      return new Response(null, { status: 429, headers: { "Retry-After": "30" } });
    }
    if (url.hostname === "cdn.foyles.co.uk" && url.pathname.endsWith("9780062662583.jpg")) return new Response(null, { status: 500 });
    if (url.hostname === "www.hachette.co.uk")
      return new Response("<html>", { headers: { "Content-Type": "text/html", "Content-Length": "1500001" } });
  });
  const throttled = await app.get(search("waterstones", { isbn: FIFTH }));
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get("Retry-After"), "30");
  assert.equal((await app.get(search("waterstones", { isbn: FIFTH }))).status, 429);
  assert.equal(blocked, 1);
  const partial = await app.get(search("foyles", { query: "The Poppy War", limit: "2" }));
  assert.equal(partial.status, 200);
  assert.equal(partial.body.partial, true);
  assert.ok(partial.body.matches.length > 0);
  assert.equal((await app.get(search("hachette-uk", { query: "The Fifth Season" }))).status, 502);
});

test("the actual negotiated no-jacket payload is excluded before decoding", async () => {
  const result = await readCover(
    { get: async () => ({ status: 200, contentType: "image/webp", bytes: placeholder }) },
    new URL("https://cdn.foyles.co.uk/bookjackets/large/9780/0000/9780000000002.jpg"),
    AbortSignal.timeout(1_000),
  );
  assert.equal(result, undefined);
  const { width, height } = await sharp(placeholder).metadata();
  assert.deepEqual([width, height], [500, 500]);
});

test("aborting a request cancels its active fetch and never starts a canceled queued fetch", async () => {
  let requests = 0;
  const started = Promise.withResolvers();
  const upstream = createUpstream({
    fetcher: (_url, request) => {
      requests++;
      started.resolve();
      return new Promise((_, reject) => request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true }));
    },
  });
  const url = new URL("https://openlibrary.org/search.json");
  const active = new AbortController();
  const queued = new AbortController();
  const request = (signal) => upstream.get(url, { signal, kind: "json", maxBytes: 256 });
  const failActive = assert.rejects(request(active.signal), SourceError);
  await started.promise;
  const failQueued = assert.rejects(request(queued.signal), { name: "AbortError" });
  queued.abort();
  active.abort();
  await Promise.all([failActive, failQueued]);
  assert.equal(requests, 1);
});
