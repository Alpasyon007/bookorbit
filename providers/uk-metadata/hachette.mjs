import * as cheerio from "cheerio";
import { cleanText, isbn13, matchAuthor, matchTitle, publicSourceUrl, readCover, yearFrom } from "./book.mjs";
import { collectMatches, SourceError } from "./upstream.mjs";

const ORIGIN = "https://www.hachette.co.uk";
const PRODUCT_PATH = /^\/titles\/[^/]+\/[^/]+\/(97[89]\d{10})\/?$/;
const COVER_PATH = /^\/wp-content\/uploads\/[^?#]+\.(?:jpe?g|png|webp)$/i;
const MAX_PRODUCTS = 8;

export function createHachette(upstream) {
  async function getProduct(url, signal) {
    const page = await requestPage(upstream, url, signal);
    if (page.status === 404 || page.status === 410) return;
    if (!page.html) throw new SourceError();
    const product = parseHachetteProduct(page.html, url);
    if (!product) throw new SourceError();
    if (product.mediaType === "audiobook") return;
    const { image, ...metadata } = product;
    const cover = image && (await readCover(upstream, image, signal));
    return { ...metadata, ...cover };
  }

  async function lookup(isbn, signal) {
    const response = await requestPage(upstream, searchUrl(isbn), signal);
    if (response.status === 404 || response.status === 410) return;
    if (!response.location) {
      if (response.html && cheerio.load(response.html)("body.search-no-results").length) return;
      throw new SourceError();
    }
    const product = publicSourceUrl(response.location, ORIGIN, PRODUCT_PATH);
    if (!product || PRODUCT_PATH.exec(product.pathname)[1] !== isbn) throw new SourceError();
    return getProduct(product, signal);
  }

  return {
    lookup,
    async search({ query, author, isbn, limit, signal }) {
      if (isbn) {
        const book = await lookup(isbn, signal);
        return { matches: book ? [book] : [] };
      }
      const response = await requestPage(upstream, searchUrl(query), signal);
      if (!response.html) throw new SourceError();
      const products = parseSearch(response.html, query, author);
      return collectMatches(products, limit, async (url) => {
        const book = await getProduct(url, signal);
        return book && matchAuthor(book.authors, author) ? book : undefined;
      });
    },
  };
}

function searchUrl(query) {
  const url = new URL(ORIGIN);
  url.searchParams.set("s", query);
  return url;
}

async function requestPage(upstream, url, signal) {
  const response = await upstream.get(url, { maxBytes: 1_500_000, kind: "html", signal });
  if (response.status !== 200) return response;
  if (!/^text\/html(?:;|$)/i.test(response.contentType)) throw new SourceError();
  return { ...response, html: response.bytes.toString("utf8") };
}

function parseSearch(html, query, author) {
  const $ = cheerio.load(html);
  if ($("body.search-no-results").length) return [];
  if (!$("body.search-results").length) throw new SourceError();
  const products = new Map();
  $(".search-result__title a").each((_, anchor) => {
    const url = publicSourceUrl($(anchor).attr("href"), ORIGIN, PRODUCT_PATH);
    const title = cleanText($(anchor).text());
    if (!url || !title) return;
    const card = $(anchor).closest(".search-result--hbg-title");
    const authors = card
      .find(".search-result__author p")
      .map((_, name) => cleanText($(name).text()))
      .get();
    if (authors.length && !matchAuthor(authors, author)) return;
    const isbn = isbn13(PRODUCT_PATH.exec(url.pathname)[1]);
    const rank = matchTitle(title, query);
    if (isbn && rank) products.set(isbn, { url, rank });
  });
  return [...products.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_PRODUCTS)
    .map(({ url }) => url);
}

export function parseHachetteProduct(html, url) {
  const expected = PRODUCT_PATH.exec(url.pathname)?.[1];
  const $ = cheerio.load(html);
  for (const script of $('script[type="application/ld+json"]')) {
    let data;
    try {
      data = JSON.parse($(script).text());
    } catch {
      continue;
    }
    const types = Array.isArray(data?.["@type"]) ? data["@type"] : [data?.["@type"]];
    const isbn = isbn13(data?.isbn);
    const title = cleanText(data?.name);
    if (!types.includes("Book") || !isbn || isbn !== expected || !title) continue;
    const image = (Array.isArray(data.image) ? data.image : [data.image])
      .map((entry) => publicSourceUrl(typeof entry === "object" ? entry?.url : entry, ORIGIN, COVER_PATH))
      .find(Boolean);
    const date = cleanText(data.datePublished)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    const authors = (Array.isArray(data.author) ? data.author : [data.author])
      .map((author) => cleanText(author?.name))
      .filter(Boolean)
      .slice(0, 16);
    return {
      providerId: isbn,
      isbn13: isbn,
      title,
      authors,
      mediaType: /audio/i.test(data.bookFormat ?? "") ? "audiobook" : "book",
      publishedYear: yearFrom(date),
      publishedDate: date,
      publisher: cleanText(data.publisher?.name),
      description: cleanText(cheerio.load(cleanText(data.description, 20_000) ?? "", {}, false).text(), 15_000),
      pages: Number.isInteger(data.numberOfPages) && data.numberOfPages > 0 ? data.numberOfPages : undefined,
      genres: (Array.isArray(data.genre) ? data.genre : [data.genre])
        .map((genre) => cleanText(genre))
        .filter(Boolean)
        .slice(0, 16),
      url: url.href,
      image,
    };
  }
}
