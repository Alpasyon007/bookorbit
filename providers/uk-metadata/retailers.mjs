import { cleanList, cleanText, isbn13, matchAuthor, matchTitle, readCover, yearFrom } from "./book.mjs";
import { collectMatches, SourceError } from "./upstream.mjs";

const LIBRARY = "https://openlibrary.org";
const WORK_PATH = /^\/works\/OL\d+W$/;
const EDITION_PATH = /^\/books\/OL\d+M$/;
const AUDIO = /audio|graphic audio|spoken word/i;
const WORK_FIELDS = "key,title,author_name";
const EDITION_FIELDS = "editions,editions.key,editions.title,editions.isbn,editions.publisher,editions.publish_date,editions.language";
const MAX_EDITIONS = 36;
const MAX_JACKET_CHECKS = 12;

export function createRetailers(upstream) {
  const discovery = createDiscovery(upstream);
  return {
    waterstones: createRetailer(upstream, discovery, "https://cdn.waterstones.com"),
    foyles: createRetailer(upstream, discovery, "https://cdn.foyles.co.uk"),
  };
}

function createRetailer(upstream, discovery, origin) {
  async function attachJacket({ providerId, title, ...metadata }, signal) {
    const jacket = new URL(`/bookjackets/large/${providerId.slice(0, 4)}/${providerId.slice(4, 8)}/${providerId}.jpg`, origin);
    const cover = await readCover(upstream, jacket, signal);
    if (cover) return { providerId, title, ...metadata, ...cover };
  }

  async function lookup(isbn, signal) {
    const edition = await discovery.exact(isbn, signal);
    if (edition) return attachJacket(edition, signal);
  }

  return {
    lookup,
    async search({ query, author, isbn, limit, signal }) {
      if (isbn) {
        const match = await lookup(isbn, signal);
        return { matches: match ? [match] : [] };
      }
      const editions = await discovery.title(query, author, signal);
      return collectMatches(editions, limit, (edition) => attachJacket(edition, signal));
    },
  };
}

function createDiscovery(upstream) {
  const cache = new Map();

  async function search(params, signal) {
    const url = new URL("/search.json", LIBRARY);
    url.search = new URLSearchParams(params);
    const data = await getJson(upstream, url, signal, cache);
    if (!Array.isArray(data?.docs)) throw new SourceError();
    return data.docs;
  }

  return {
    async exact(isbn, signal) {
      const [work] = await search({ isbn, fields: `${WORK_FIELDS},${EDITION_FIELDS}`, limit: "1" }, signal);
      if (!work) return;
      const edition = work.editions?.docs?.find((item) => cleanList(item?.isbn).some((itemIsbn) => isbn13(itemIsbn) === isbn));
      if (!edition) throw new SourceError();
      return makeEdition({
        isbn,
        raw: edition,
        title: cleanText(edition.title) ?? cleanText(work.title),
        authors: cleanList(work.author_name),
        publisher: cleanList(edition.publisher)[0],
        publishedYear: yearFrom(cleanList(edition.publish_date)[0]),
      });
    },
    async title(query, author, signal) {
      const docs = await search({ title: query, ...(author ? { author } : {}), fields: WORK_FIELDS, limit: "4" }, signal);
      const works = docs
        .flatMap((item) => {
          const title = cleanText(item?.title);
          const authors = cleanList(item?.author_name);
          const rank = title ? matchTitle(title, query) : 0;
          return rank && matchAuthor(authors, author) && WORK_PATH.test(item.key) ? [{ ...item, title, authors, rank }] : [];
        })
        .sort((a, b) => b.rank - a.rank);
      if (!works.length) return [];

      const [work] = works;
      const url = new URL(`${work.key}/editions.json`, LIBRARY);
      url.searchParams.set("limit", String(MAX_EDITIONS));
      const data = await getJson(upstream, url, signal, cache);
      if (!Array.isArray(data?.entries)) throw new SourceError();

      const editions = data.entries.slice(0, MAX_EDITIONS).flatMap((entry) => editionsOfWork(entry, work));
      const sorted = editions.sort((a, b) => b.rank - a.rank);
      const distinct = new Map();
      for (const { rank: _rank, ...edition } of sorted) {
        if (!distinct.has(edition.providerId)) distinct.set(edition.providerId, edition);
        if (distinct.size >= MAX_JACKET_CHECKS) break;
      }
      return [...distinct.values()];
    },
  };
}

function editionsOfWork(entry, work) {
  const publishers = cleanList(entry?.publishers);
  if (AUDIO.test(entry?.physical_format ?? "") || publishers.some((name) => AUDIO.test(name))) return [];
  const title = cleanText(entry?.title);
  const rank = title ? matchTitle(title, work.title) : 0;
  const languages = Array.isArray(entry?.languages) ? entry.languages : [];
  const english = languages.some((language) => language?.key === "/languages/eng");
  if (!rank || (languages.length > 0 && !english)) return [];
  const places = cleanList(entry.publish_places);
  const uk = places.some((place) => /london|\b(?:uk|england|united kingdom)\b/i.test(place));
  const print = /paperback|hardback|hardcover/i.test(entry.physical_format ?? "");
  const isbnValues = cleanList(entry.isbn_13).concat(cleanList(entry.isbn_10));
  return isbnValues.slice(0, 4).flatMap((value) => {
    const isbn = isbn13(value);
    if (!isbn) return [];
    const edition = makeEdition({
      isbn,
      raw: entry,
      title,
      authors: work.authors,
      publisher: publishers[0],
      publishedYear: yearFrom(entry.publish_date),
    });
    if (!edition) return [];
    return [{ ...edition, rank: rank + (uk ? 8 : 0) + (print ? 4 : 0) + (english ? 2 : 0) + (/^978[01]/.test(isbn) ? 2 : 0) }];
  });
}

function makeEdition({ isbn, raw, title, authors, publisher, publishedYear }) {
  if (!title || !EDITION_PATH.test(raw?.key) || AUDIO.test(raw?.physical_format ?? "") || AUDIO.test(publisher ?? "")) return;
  const languages = Array.isArray(raw.language) ? raw.language : raw.languages?.map((item) => item?.key?.split("/").pop());
  return {
    providerId: isbn,
    isbn13: isbn,
    title,
    mediaType: "book",
    authors,
    publisher,
    publishedYear,
    languageCode: languages?.includes("eng") ? "en" : undefined,
    pages: Number.isInteger(raw.number_of_pages) && raw.number_of_pages > 0 ? raw.number_of_pages : undefined,
    url: new URL(raw.key, LIBRARY).href,
  };
}

async function getJson(upstream, url, signal, cache) {
  const key = url.href;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.data;
  const response = await upstream.get(url, { maxBytes: 512 * 1024, kind: "json", signal });
  if (response.status !== 200 || !/^application\/json(?:;|$)/i.test(response.contentType)) throw new SourceError();
  try {
    const data = JSON.parse(response.bytes.toString("utf8"));
    if (Array.isArray(data?.docs) || Array.isArray(data?.entries)) {
      cache.set(key, { data, expires: Date.now() + 10 * 60 * 1_000 });
      if (cache.size > 32) cache.delete(cache.keys().next().value);
    }
    return data;
  } catch {
    throw new SourceError();
  }
}
