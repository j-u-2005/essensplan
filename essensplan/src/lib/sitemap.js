import { decodeEntities } from './jsonld.js';

/** Liest eine Sitemap oder einen Sitemap-Index und liefert { sitemaps, urls } */
export function parseSitemapXml(xml) {
  const text = String(xml || '');
  const isIndex = /<sitemapindex[\s>]/i.test(text);
  const locs = [];
  const re = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(text))) locs.push(decodeEntities(m[1]).trim());
  return isIndex ? { sitemaps: locs, urls: [] } : { sitemaps: [], urls: locs };
}
