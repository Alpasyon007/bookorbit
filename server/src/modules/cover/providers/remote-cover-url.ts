export function parseCoverSearchUrl(raw: unknown): URL | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return;
  const url = URL.parse(raw);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return;
  url.hash = '';
  return url.href.length <= 2048 ? url : undefined;
}
