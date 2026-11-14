import { createHash } from "node:crypto";
import sharp from "sharp";
import { SourceError } from "./upstream.mjs";

export function isbn13(value) {
  if (typeof value !== "string") return;
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{9}[\dX]$/.test(compact)) {
    const sum = [...compact].reduce((total, digit, index) => total + (digit === "X" ? 10 : Number(digit)) * (10 - index), 0);
    if (sum % 11 !== 0) return;
    const prefix = `978${compact.slice(0, 9)}`;
    return `${prefix}${checkDigit(prefix)}`;
  }
  if (/^97[89]\d{10}$/.test(compact) && checkDigit(compact.slice(0, 12)) === Number(compact[12])) return compact;
}

function checkDigit(prefix) {
  const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function cleanText(value, maxLength = 500) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) || undefined : undefined;
}

export function cleanList(value) {
  return Array.isArray(value)
    ? value
        .map((entry) => cleanText(entry))
        .filter(Boolean)
        .slice(0, 16)
    : [];
}

export function searchKey(value) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function matchTitle(value, query) {
  const compare = (text) => searchKey(text.replace(/^(the|a|an)\s+/i, ""));
  const title = compare(value);
  const requested = compare(query);
  if (!requested) return 0;
  return title === requested ? 2 : title.includes(requested) ? 1 : 0;
}

export function matchAuthor(authors, query) {
  if (!query) return true;
  const requested = searchKey(query);
  return Boolean(requested) && authors.some((author) => searchKey(author).includes(requested));
}

export function yearFrom(value) {
  return cleanText(value)?.match(/\b(?:1[5-9]|20)\d{2}\b/)?.[0];
}

export function publicSourceUrl(value, origin, testPath) {
  if (typeof value !== "string" || value.length > 2_048) return;
  let url;
  try {
    url = new URL(value, origin);
  } catch {
    return;
  }
  if (url.origin === origin && !url.username && !url.password && !url.hash && testPath.test(url.pathname)) return url;
}

const JACKETS_MISSING = new Set([
  "92cd2b508bf36787266277f5e529839f703568e7134becaf40509b2c00904e71",
  "4ee4ff9b93dbaf3df2a141b7069dadea78bcc2ad031bdeaf547b7cc6f26cc7dc",
]);

export async function readCover(upstream, url, signal) {
  const response = await upstream.get(url, { maxBytes: 3 * 1024 * 1024, kind: "image", signal });
  if (response.status === 404 || response.status === 410) return;
  if (response.status !== 200 || !/^image\/(jpeg|png|webp)(?:;|$)/i.test(response.contentType)) throw new SourceError();
  const fingerprint = createHash("sha256").update(response.bytes).digest("hex");
  if (JACKETS_MISSING.has(fingerprint)) return;

  try {
    const image = sharp(response.bytes, { limitInputPixels: 12_000_000, failOn: "warning" });
    const { width, height, format, orientation } = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(format) || width < 150 || height < 200 || width / height > 0.85 || height / width > 2.8) return;
    if (orientation && orientation > 4) return;
    // Decode the image as well as its headers so a truncated jacket never becomes a result.
    await image.resize(1, 1).toBuffer();
    return { cover: url.href, coverWidth: width, coverHeight: height };
  } catch {
    throw new SourceError();
  }
}
