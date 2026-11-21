/** Minimaler robots.txt-Parser (Agents, Allow/Disallow mit * und $, Crawl-delay, Sitemap) */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' && value) current.allow.push(value);
    else if (field === 'disallow' && value) current.disallow.push(value);
    else if (field === 'crawl-delay') {
      const n = parseFloat(value);
      if (!Number.isNaN(n)) current.crawlDelay = n;
    }
  }
  return { groups, sitemaps };
}

function pickGroup(robots, ua) {
  const token = String(ua || '').toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const a of g.agents) {
      if (a === '*') {
        if (bestLen < 0) {
          best = g;
          bestLen = 0;
        }
      } else if (token.includes(a) && a.length > bestLen) {
        best = g;
        bestLen = a.length;
      }
    }
  }
  return best;
}

function ruleToRegex(rule) {
  const esc = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc.replace(/\\\$$/, '$'));
}

export function isAllowed(robots, pathWithQuery, ua) {
  const g = pickGroup(robots, ua);
  if (!g) return true;
  let bestLen = -1;
  let allowed = true;
  for (const r of g.disallow) {
    if (ruleToRegex(r).test(pathWithQuery) && r.length > bestLen) {
      bestLen = r.length;
      allowed = false;
    }
  }
  for (const r of g.allow) {
    if (ruleToRegex(r).test(pathWithQuery) && r.length >= bestLen) {
      bestLen = r.length;
      allowed = true;
    }
  }
  return allowed;
}

export function crawlDelay(robots, ua) {
  const g = pickGroup(robots, ua);
  return g?.crawlDelay ?? null;
}
