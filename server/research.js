/**
 * Skip research pipeline — free public sources only, no invented reviews.
 * Tries DuckDuckGo HTML, Bing HTML (fallback), Reddit JSON, and CPSC recalls.
 * v0.3: honesty / scam-oriented queries and plain-language verdict labels.
 */

const cheerio = require("cheerio");

const USER_AGENT = "SkipBot/0.3 (+local research)";
const FETCH_MS = 8000;
const OVERALL_MS = 18000;

const VERDICT_LABELS = {
  Buy: "Good to buy",
  Wait: "Not clear yet",
  Skip: "Don't buy",
};

function attachVerdictLabels(payload) {
  const verdict = payload.verdict || "Wait";
  const verdictLabel = VERDICT_LABELS[verdict] || VERDICT_LABELS.Wait;
  const reason =
    payload.reason ||
    oneLineReason(verdict, payload.summary || "");
  return { ...payload, verdict, verdictLabel, reason };
}

function oneLineReason(verdict, summary) {
  const s = String(summary || "").replace(/\s+/g, " ").trim();
  if (!s) {
    if (verdict === "Buy") return "Independent chatter looks okay — still verify the exact listing.";
    if (verdict === "Skip") return "Public sources raise scam, safety, or hard-avoid signals.";
    return "Not enough honest signal to recommend buying yet.";
  }
  // Prefer first sentence, capped for the result page one-liner
  const first = s.split(/(?<=[.!?])\s+/)[0] || s;
  return first.length > 160 ? first.slice(0, 157) + "…" : first;
}

const NEGATIVE = [
  { re: /\brecall(ed|s)?\b/i, tag: "recall", weight: 5 },
  { re: /\b(fire|burn|explod|overheat|swelling|swollen|smoke)\b/i, tag: "safety", weight: 5 },
  { re: /\b(hazard|injury|danger(?:ous)?)\b/i, tag: "safety", weight: 4 },
  { re: /\b(scam|fraud|phishing|phish(?:ing)?\s+store)\b/i, tag: "scam", weight: 6 },
  { re: /\b(counterfeit|knock[- ]?off|replica)\b/i, tag: "counterfeit", weight: 6 },
  { re: /\bfake\s+reviews?\b|\breview\s+(?:farm|manipulation|bot|bought)\b|\bincentivized\s+reviews?\b/i, tag: "fake_reviews", weight: 5 },
  { re: /\b(fake\b|forged)\b/i, tag: "scam", weight: 4 },
  { re: /\b(don'?t buy|do not buy|avoid|waste of money|rip[- ]?off)\b/i, tag: "avoid", weight: 3 },
  { re: /\b(return(?:ed|ing)?|refund|chargeback)\b/i, tag: "returns", weight: 2 },
  { re: /\b(broke|broken|defect(?:ive)?|failure|failed|stopped working|dead on arrival|doa)\b/i, tag: "quality", weight: 3 },
  { re: /\b(warranty|support horror|customer service|no support|ignored)\b/i, tag: "support", weight: 2 },
  { re: /\b(battery (?:life|drain|swelling)|capacity (?:lie|lies|false|short)|underdeliver)/i, tag: "battery", weight: 3 },
  { re: /\b(sizing|runs small|runs large|fit issue|too tight|too loose)\b/i, tag: "sizing", weight: 2 },
  { re: /\b(complaint|problem|issue|issue[sd]?|bug|glitch)\b/i, tag: "complaint", weight: 1 },
];

const POSITIVE = [
  /\b(recommend|highly recommend|worth (?:it|the money)|love(?:d|s)? (?:it|this)|works (?:great|well)|reliable|solid build|no (?:issues|problems)|happy with)\b/i,
  /\b(best |great |excellent |amazing )?(?:power bank|charger|product)\b/i,
];

const MARKETING_HOSTS = [
  "anker.com",
  "ankersolix.com",
  "anker-online.com",
  "ankerjapan.com",
  "service.anker.com",
  "amazon.com",
  "walmart.com",
  "bestbuy.com",
  "target.com",
  "ebay.com",
  "shopify.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "apple.com",
  "samsung.com",
];

const MARKETPLACE_HOSTS = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.ca",
  "amazon.de",
  "ebay.com",
  "walmart.com",
  "aliexpress.com",
  "wish.com",
  "temu.com",
  "etsy.com",
  "shopify.com",
];

const SPAM_HOST_RE = /(xnxx|pornhub|xvideos|onlyfans|chaturbate|porn|xxx\b)/i;

function withTimeout(ms, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchText(url, { ms = FETCH_MS, signal, accept } = {}) {
  const t = withTimeout(ms, signal);
  try {
    const res = await fetch(url, {
      signal: t.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept || "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, url: res.url || url, text };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      url,
      text: "",
      error: err.name === "AbortError" ? "timeout" : err.message,
    };
  } finally {
    t.clear();
  }
}

function decodeBingUrl(href) {
  if (!href) return null;
  try {
    if (!href.includes("bing.com/ck/")) return href;
    const u = new URL(href, "https://www.bing.com");
    const raw = u.searchParams.get("u");
    if (!raw) return href;
    const payload = raw.startsWith("a1") ? raw.slice(2) : raw;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* keep original */
  }
  return href;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isGovOrWatchdog(url) {
  const h = hostOf(url);
  return /(^|\.)cpsc\.gov$/i.test(h) || /(^|\.)fda\.gov$/i.test(h) || /(^|\.)bbb\.org$/i.test(h);
}

function isLikelyMarketing(url, title = "") {
  const h = hostOf(url);
  if (!h) return true;
  if (SPAM_HOST_RE.test(h)) return true;
  if (isGovOrWatchdog(url)) return false;
  // Manufacturer recall notices are evidence, not ads
  if (/recall/i.test(url) || /recall/i.test(title || "")) return false;
  return MARKETING_HOSTS.some((m) => h === m || h.endsWith("." + m));
}

function isMarketplace(url) {
  const h = hostOf(url);
  return MARKETPLACE_HOSTS.some((m) => h === m || h.endsWith("." + m));
}

function isSpamUrl(url) {
  const h = hostOf(url);
  return !h || SPAM_HOST_RE.test(h);
}

function productTokens(title) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "pack",
    "new",
    "set",
    "pro",
    "max",
    "plus",
    "usb",
    "type",
    "black",
    "white",
    "official",
    "amazon",
  ]);
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s+.-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t))
    .slice(0, 8);
}

function mentionsProduct(text, tokens) {
  if (!text || !tokens.length) return false;
  const hay = text.toLowerCase();
  const hits = tokens.filter((t) => hay.includes(t));
  const numeric = tokens.filter((t) => /\d/.test(t));
  const long = tokens.filter((t) => t.length >= 6);
  // Prefer model-ish tokens when present
  if (numeric.length) {
    return numeric.every((t) => hay.includes(t)) && hits.length >= Math.min(2, tokens.length);
  }
  if (long.length >= 1) {
    return long.every((t) => hay.includes(t)) && hits.length >= 2;
  }
  return hits.length >= Math.min(2, tokens.length);
}

function parseDdgHtml(html) {
  const $ = cheerio.load(html);
  if (
    html.includes("anomaly-modal") ||
    html.includes("Unfortunately, bots use DuckDuckGo") ||
    $("a.result__a").length === 0
  ) {
    return { blocked: $("a.result__a").length === 0, results: [] };
  }
  const results = [];
  $("div.result, .links_main").each((_, el) => {
    const a = $(el).find("a.result__a").first();
    let href = a.attr("href") || "";
    // DDG sometimes wraps redirects
    try {
      const u = new URL(href, "https://html.duckduckgo.com");
      if (u.pathname.includes("/l/") && u.searchParams.get("uddg")) {
        href = decodeURIComponent(u.searchParams.get("uddg"));
      } else {
        href = u.toString();
      }
    } catch {
      /* ignore */
    }
    const title = a.text().trim();
    const snippet = $(el).find(".result__snippet, a.result__snippet").text().trim();
    if (title && href && /^https?:\/\//i.test(href)) {
      results.push({ title, url: href, snippet, engine: "duckduckgo" });
    }
  });
  return { blocked: false, results };
}

function parseBingHtml(html) {
  const $ = cheerio.load(html);
  const results = [];
  $("li.b_algo").each((_, el) => {
    const a = $(el).find("h2 a").first();
    const title = a.text().trim();
    const href = decodeBingUrl(a.attr("href"));
    const snippet =
      $(el).find(".b_caption p").first().text().trim() ||
      $(el).find("p").first().text().trim() ||
      "";
    if (title && href && /^https?:\/\//i.test(href)) {
      results.push({ title, url: href, snippet, engine: "bing" });
    }
  });
  return results;
}

function parseRedditJson(text) {
  try {
    const data = JSON.parse(text);
    const children = data?.data?.children || [];
    return children.map((c) => {
      const d = c.data || {};
      const permalink = d.permalink
        ? `https://www.reddit.com${d.permalink}`
        : d.url || "";
      return {
        title: d.title || "",
        url: permalink,
        snippet: (d.selftext || "").slice(0, 280),
        engine: "reddit",
      };
    }).filter((r) => r.title && r.url);
  } catch {
    return [];
  }
}

function parseCpscHtml(html, tokens) {
  const $ = cheerio.load(html);
  const results = [];
  const pushHit = (title, href, snippet) => {
    if (!title || title.length < 12) return;
    const blob = `${title} ${snippet || ""}`;
    if (!mentionsProduct(blob, tokens) && !mentionsProduct(title, tokens)) return;
    let url = href || "";
    try {
      url = new URL(url, "https://www.cpsc.gov").toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(url)) return;
    if (!/recall/i.test(url) && !/recall/i.test(title)) return;
    results.push({
      title: title.replace(/\s+/g, " ").trim(),
      url,
      snippet: (snippet || title).replace(/\s+/g, " ").trim().slice(0, 280),
      engine: "cpsc",
    });
  };

  $("a[href*='/Recalls/'], a[href*='/recalls/']").each((_, el) => {
    const title = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href") || "";
    const parentText = $(el).parent().text().replace(/\s+/g, " ").trim().slice(0, 280);
    pushHit(title, href, parentText);
  });

  // Fallback: any link whose text mentions recall + product tokens
  if (results.length === 0) {
    $("a").each((_, el) => {
      const title = $(el).text().replace(/\s+/g, " ").trim();
      if (!/recall/i.test(title)) return;
      pushHit(title, $(el).attr("href") || "", title);
    });
  }

  const seen = new Set();
  return results
    .filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    })
    .slice(0, 8);
}

async function searchDuckDuckGo(query, signal) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchText(url, { signal });
  if (!res.ok && res.status !== 202) return [];
  const parsed = parseDdgHtml(res.text);
  return parsed.results;
}

async function searchBing(query, signal) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetchText(url, { signal });
  if (!res.ok) return [];
  return parseBingHtml(res.text);
}

async function searchReddit(query, signal) {
  const url =
    `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}` +
    `&sort=relevance&t=year&limit=10`;
  const res = await fetchText(url, {
    signal,
    accept: "application/json",
  });
  if (!res.ok) return [];
  // Reddit often returns HTML challenge on 403 body with ok:false
  if (res.text.trim().startsWith("<")) return [];
  return parseRedditJson(res.text);
}

async function searchCpsc(title, tokens, signal) {
  // Prefer brand + category keywords for recall search
  const brand = tokens[0] || title.split(/\s+/)[0];
  const q = `${brand} ${tokens.find((t) => /\d/.test(t)) || ""}`.trim();
  const url = `https://www.cpsc.gov/Recalls?search_api_fulltext=${encodeURIComponent(q)}`;
  const res = await fetchText(url, { signal });
  if (!res.ok) return [];
  return parseCpscHtml(res.text, tokens);
}

function dedupeResults(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    let key;
    try {
      const u = new URL(item.url);
      key = (u.hostname.replace(/^www\./, "") + u.pathname).toLowerCase().replace(/\/$/, "");
    } catch {
      key = item.url;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function scoreHit(hit) {
  const text = `${hit.title} ${hit.snippet}`;
  let neg = 0;
  const tags = new Set();
  for (const { re, tag, weight } of NEGATIVE) {
    if (re.test(text)) {
      neg += weight;
      tags.add(tag);
    }
  }
  let pos = 0;
  for (const re of POSITIVE) {
    if (re.test(text)) pos += 1;
  }
  return { neg, pos, tags: [...tags] };
}

function themeTitle(tag) {
  switch (tag) {
    case "recall":
      return "Safety recall mentions found";
    case "safety":
      return "Safety / overheating / fire concerns";
    case "scam":
      return "Scam or phishing-store warnings";
    case "counterfeit":
      return "Counterfeit / knock-off warnings";
    case "fake_reviews":
      return "Fake-review patterns mentioned";
    case "avoid":
      return "Explicit 'don't buy' / avoid language";
    case "returns":
      return "Returns and refund friction";
    case "quality":
      return "Quality failures or early breakage";
    case "support":
      return "Warranty / support complaints";
    case "battery":
      return "Battery life or capacity complaints";
    case "sizing":
      return "Sizing / fit complaints";
    case "complaint":
      return "Recurring problem reports";
    case "thin_brand":
      return "Unknown brand — mostly one marketplace listing";
    case "price_outlier":
      return "Price looks wildly below comps";
    default:
      return "Reported issues in public sources";
  }
}

function parseMoney(str) {
  if (!str) return null;
  const m = String(str).replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
}

function inferPriceFromSnippets(relevant) {
  const prices = [];
  for (const hit of relevant) {
    const blob = `${hit.title} ${hit.snippet}`;
    const re = /(?:USD|US\$|\$)\s?([\d,]+(?:\.\d{2})?)/gi;
    let m;
    while ((m = re.exec(blob))) {
      const n = Number(m[1].replace(/,/g, ""));
      if (n >= 5 && n <= 50000) prices.push(n);
    }
  }
  return prices;
}

function buildHonestyGotchas(relevant, { price, title, tokens }) {
  const extra = [];
  const scored = relevant.map((h) => ({ hit: h, ...scoreHit(h) }));

  // Fake-review patterns
  const fakeHits = scored.filter((s) => s.tags.includes("fake_reviews"));
  if (fakeHits.length) {
    const urls = [...new Set(fakeHits.map((s) => s.hit.url))].slice(0, 3);
    const snip = (fakeHits[0].hit.snippet || fakeHits[0].hit.title || "").replace(/\s+/g, " ").trim().slice(0, 220);
    extra.push({
      title: themeTitle("fake_reviews"),
      detail: snip
        ? `Public hits mention fake or manipulated reviews: ${snip}`
        : "Public hits mention fake or manipulated reviews for this product name.",
      sourceUrls: urls,
      type: "fake_reviews",
    });
  }

  // Unknown brand only sold on one marketplace listing
  const brandToken = tokens[0];
  const brandMentions = relevant.filter((h) => {
    const blob = `${h.title} ${h.snippet}`.toLowerCase();
    return brandToken && blob.includes(brandToken);
  });
  const nonMarketplace = brandMentions.filter((h) => !isMarketplace(h.url) && !isLikelyMarketing(h.url, h.title));
  const marketplaceOnly = brandMentions.filter((h) => isMarketplace(h.url));
  const knownBrandHint = /amazon|apple|samsung|sony|anker|bose|nike|adidas|microsoft|google|lg|dell|hp\b/i.test(
    title || ""
  );
  if (
    brandToken &&
    !knownBrandHint &&
    marketplaceOnly.length >= 1 &&
    nonMarketplace.length === 0 &&
    brandMentions.length <= 3
  ) {
    extra.push({
      title: themeTitle("thin_brand"),
      detail: `Almost all public hits for “${brandToken}” look like a single marketplace listing — little independent brand footprint. That pattern often shows up with unknown or drop-ship brands.`,
      sourceUrls: marketplaceOnly.slice(0, 2).map((h) => h.url),
      type: "thin_brand",
    });
  }

  // Price wildly below comps (only if we can infer from snippets)
  const listed = parseMoney(price);
  const snippetPrices = inferPriceFromSnippets(relevant);
  if (listed != null && snippetPrices.length >= 2) {
    const sorted = [...snippetPrices].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)];
    if (mid > 0 && listed < mid * 0.4 && mid - listed >= 20) {
      extra.push({
        title: themeTitle("price_outlier"),
        detail: `Listed around ${price} while public snippets mention prices nearer $${Math.round(mid)}. A gap that large can mean a different SKU, a clearance deal — or a counterfeit / bait listing. Confirm against trusted sellers.`,
        sourceUrls: relevant
          .filter((h) => /\$\s?[\d,]+/.test(`${h.title} ${h.snippet}`))
          .slice(0, 2)
          .map((h) => h.url),
        type: "price_outlier",
      });
    }
  }

  return extra;
}

function buildGotchas(relevant) {
  const buckets = new Map();
  for (const hit of relevant) {
    const { neg, tags } = scoreHit(hit);
    if (neg <= 0) continue;
    const primary = tags[0] || "complaint";
    if (!buckets.has(primary)) buckets.set(primary, []);
    buckets.get(primary).push({ hit, neg, tags });
  }

  const ranked = [...buckets.entries()]
    .map(([tag, items]) => ({
      tag,
      items: items.sort((a, b) => b.neg - a.neg),
      score: items.reduce((s, i) => s + i.neg, 0),
    }))
    .sort((a, b) => b.score - a.score);

  const gotchas = [];
  for (const bucket of ranked) {
    if (gotchas.length >= 5) break;
    const top = bucket.items.slice(0, 3);
    const urls = [...new Set(top.map((t) => t.hit.url))].slice(0, 3);
    const snippets = top
      .map((t) => (t.hit.snippet || t.hit.title || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 2);
    if (!snippets.length || !urls.length) continue;

    const detailParts = snippets.map((s) => {
      const clipped = s.length > 220 ? s.slice(0, 217) + "…" : s;
      return clipped;
    });

    gotchas.push({
      title: themeTitle(bucket.tag),
      detail: `From public search hits: ${detailParts.join(" · ")}`,
      sourceUrls: urls,
      type: bucket.tag,
    });
  }
  return gotchas;
}

function buildSources(relevant, metaUrl) {
  const sources = [];
  if (metaUrl) {
    sources.push({
      label: "Product page (fetched)",
      url: metaUrl,
      note: "Public HTML metadata.",
    });
  }
  const preferred = [...relevant].sort((a, b) => {
    const sa = scoreHit(a).neg;
    const sb = scoreHit(b).neg;
    // Prefer non-marketing with higher negative signal, else any discussion
    const ma = isLikelyMarketing(a.url, a.title) ? 1 : 0;
    const mb = isLikelyMarketing(b.url, b.title) ? 1 : 0;
    return sb - sa || ma - mb;
  });

  const seen = new Set(sources.map((s) => s.url));
  for (const hit of preferred) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    const host = hostOf(hit.url) || hit.engine;
    sources.push({
      label: hit.title.slice(0, 90) || host,
      url: hit.url,
      note: `${hit.engine} result` + (hit.snippet ? ` — ${hit.snippet.slice(0, 100)}` : ""),
    });
    if (sources.length >= 8) break;
  }
  return sources;
}

function buildHonestyFlags(relevant, gotchas, researched) {
  const scored = relevant.map((h) => ({ hit: h, ...scoreHit(h) }));
  const independent = relevant.filter((h) => !isLikelyMarketing(h.url, h.title));
  const scamMentions = scored.some(
    (s) =>
      s.tags.includes("scam") ||
      s.tags.includes("counterfeit") ||
      s.tags.includes("fake_reviews") ||
      /phishing/i.test(`${s.hit.title} ${s.hit.snippet}`)
  );
  const recallMentions = scored.some(
    (s) => s.tags.includes("recall") || s.tags.includes("safety")
  );
  const thinEvidence =
    !researched ||
    relevant.length < 2 ||
    (independent.length === 0 && !scamMentions && !recallMentions);

  return {
    independentSources: independent.length >= 1,
    scamMentions,
    recallMentions,
    thinEvidence,
  };
}

function decideVerdict(relevant, gotchas, honesty) {
  const scored = relevant.map((h) => ({ hit: h, ...scoreHit(h) }));
  const independentSerious = scored.filter(
    (s) =>
      s.neg >= 3 &&
      !isLikelyMarketing(s.hit.url, s.hit.title) &&
      (s.tags.includes("recall") ||
        s.tags.includes("safety") ||
        s.tags.includes("scam") ||
        s.tags.includes("counterfeit") ||
        s.tags.includes("fake_reviews") ||
        s.tags.includes("quality") ||
        s.tags.includes("avoid"))
  );

  // Distinct hosts among serious
  const seriousHosts = new Set(independentSerious.map((s) => hostOf(s.hit.url)));
  const totalNeg = scored.reduce((n, s) => n + s.neg, 0);
  const totalPos = scored.reduce((n, s) => n + s.pos, 0);
  const discussion = relevant.filter((h) => !isLikelyMarketing(h.url, h.title));

  // Heavy weight: scam / fake reviews / counterfeit / phishing store → Skip
  const scamSerious = scored.filter(
    (s) =>
      s.tags.includes("scam") ||
      s.tags.includes("counterfeit") ||
      s.tags.includes("fake_reviews")
  );
  const scamHosts = new Set(scamSerious.map((s) => hostOf(s.hit.url)));
  if (scamHosts.size >= 1 && (scamSerious.length >= 2 || scamHosts.size >= 2 || independentSerious.some((s) => s.tags.includes("scam") || s.tags.includes("counterfeit") || s.tags.includes("fake_reviews")))) {
    return {
      verdict: "Skip",
      summary:
        "Public sources mention scam, fake reviews, or counterfeit risk for this product name. Don't buy until you verify a trusted seller and authentic listing.",
    };
  }
  if (honesty.scamMentions && scamSerious.length >= 1 && !isLikelyMarketing(scamSerious[0].hit.url, scamSerious[0].hit.title)) {
    return {
      verdict: "Skip",
      summary:
        "At least one independent hit flags scam, fake reviews, or counterfeit language. Don't buy on trust alone — open the sources first.",
    };
  }

  if (seriousHosts.size >= 2 || (seriousHosts.size >= 1 && independentSerious.some((s) => s.tags.includes("recall") || s.tags.includes("safety")))) {
    // Single official recall + another independent hit, or multiple independents
    const hasRecall = independentSerious.some((s) => s.tags.includes("recall") || s.tags.includes("safety"));
    if (hasRecall || seriousHosts.size >= 2) {
      return {
        verdict: "Skip",
        summary:
          "Multiple public sources raise serious recurring issues (safety, recall, or hard avoid signals). Skip unless you verify the exact SKU is unaffected.",
      };
    }
  }

  if (relevant.length < 2 || (discussion.length === 0 && gotchas.length === 0) || honesty.thinEvidence) {
    return {
      verdict: "Wait",
      summary:
        "Research found little usable independent discussion. Waiting is the honest call — we did not invent reviews to fill the gap.",
    };
  }

  if (gotchas.length >= 2 && totalNeg >= totalPos + 3) {
    return {
      verdict: "Wait",
      summary:
        "Public chatter is mixed or leans negative without a clean all-clear. Wait for a clearer SKU match or more independent reports.",
    };
  }

  const hasSafetyGotcha = gotchas.some((g) =>
    /recall|safety|fire|scam|hazard|counterfeit|fake-review|phishing/i.test(`${g.title} ${g.detail}`)
  );
  if (hasSafetyGotcha) {
    return {
      verdict: "Skip",
      summary:
        "Public sources include recall, safety-hazard, or scam language tied to this product name. Skip unless you confirm your exact unit is outside the affected set.",
    };
  }

  if (gotchas.some((g) => g.type === "thin_brand" || g.type === "price_outlier")) {
    return {
      verdict: "Wait",
      summary:
        "Honesty signals look thin — unknown-brand footprint or a price that doesn't match comps. Not clear yet; verify the seller before buying.",
    };
  }

  if (gotchas.length === 0 && discussion.length >= 1 && totalPos >= 1) {
    return {
      verdict: "Buy",
      summary:
        "Found real public discussion with no strong red flags in titles/snippets we fetched. Still verify warranty and the exact model yourself.",
    };
  }

  if (gotchas.length <= 1 && discussion.length >= 2 && totalNeg < 4) {
    return {
      verdict: "Buy",
      summary:
        "Sources are mostly benign or positive enough, with no cluster of serious failures in what we fetched. Double-check the live listing details.",
    };
  }

  if (gotchas.length === 0 && discussion.length === 0) {
    return {
      verdict: "Wait",
      summary:
        "Mostly marketing pages — not enough independent signal to recommend buying.",
    };
  }

  return {
    verdict: "Wait",
    summary:
      "Evidence is thin or mixed after a quick public-source pass. Wait unless you already trust this brand and SKU.",
  };
}

async function researchProduct({ title, url, price, siteName } = {}) {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) {
    return attachVerdictLabels({
      verdict: "Wait",
      summary: "No product title to research.",
      gotchas: [
        {
          title: "Missing title",
          detail: "Provide a URL we can read or a manual product title.",
          sourceUrls: [],
        },
      ],
      sources: url
        ? [{ label: "Provided URL", url, note: "No title available for search." }]
        : [],
      researched: false,
      honesty: {
        independentSources: false,
        scamMentions: false,
        recallMentions: false,
        thinEvidence: true,
      },
      disclaimer:
        "No research ran because there was no product title. Skip does not invent reviews.",
    });
  }

  const tokens = productTokens(cleanTitle);
  const brandBit = (siteName || tokens[0] || cleanTitle.split(/\s+/)[0] || "").trim();
  const queries = [
    `"${cleanTitle}" review problems`,
    `"${cleanTitle}" complaint OR "don't buy" OR returned`,
    `"${cleanTitle}" reddit`,
    `${cleanTitle} recall OR fire OR overheat OR swelling`,
    `${cleanTitle} site:reddit.com`,
    `${cleanTitle} site:cpsc.gov`,
    // Honesty / scam-oriented queries (v0.3)
    `"${cleanTitle}" scam`,
    `"${cleanTitle}" fake reviews`,
    `"${cleanTitle}" "don't buy"`,
    `"${cleanTitle}" counterfeit`,
    brandBit ? `${brandBit} complaint` : null,
  ].filter(Boolean);

  // Per-request timeouts keep wall-clock ~FETCH_MS; avoid chaining many abort listeners.
  {
    const tasks = [
      ...queries.map((q) => searchDuckDuckGo(q)),
      ...queries.map((q) => searchBing(q)),
      searchReddit(cleanTitle),
      searchReddit(`${cleanTitle} scam OR "fake reviews" OR counterfeit`),
      searchCpsc(cleanTitle, tokens),
    ];

    const settled = await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) =>
        setTimeout(() => resolve(tasks.map(() => ({ status: "rejected", reason: "overall-timeout" }))), OVERALL_MS)
      ),
    ]);
    const collected = [];
    for (const s of settled) {
      if (s.status === "fulfilled" && Array.isArray(s.value)) {
        collected.push(...s.value);
      }
    }

    const deduped = dedupeResults(collected);
    const relevant = deduped.filter((hit) => {
      if (isSpamUrl(hit.url)) return false;
      const text = `${hit.title} ${hit.snippet}`;
      return mentionsProduct(text, tokens);
    });

    if (relevant.length === 0) {
      const fallbackGotchas = [
        {
          title: "Almost nothing usable found",
          detail: `Searched public web results for “${cleanTitle}” (including scam / fake-review queries) but could not keep pages that clearly mention this product. DuckDuckGo/Reddit may block bots; Bing/CPSC were also queried when reachable.`,
          sourceUrls: [],
        },
      ];
      if (price) {
        fallbackGotchas.push({
          title: `Listed price signal: ${price}`,
          detail:
            "From page metadata only — not verified against other sellers.",
          sourceUrls: url ? [url] : [],
        });
      }
      const honesty = {
        independentSources: false,
        scamMentions: false,
        recallMentions: false,
        thinEvidence: true,
      };
      return attachVerdictLabels({
        verdict: "Wait",
        summary:
          "Research found almost nothing usable for this exact product. Wait — we are not inventing gotchas.",
        gotchas: fallbackGotchas.slice(0, 5),
        sources: url
          ? [
              {
                label: "Product page (fetched)",
                url,
                note: "Public HTML metadata only.",
              },
            ]
          : [],
        researched: false,
        honesty,
        disclaimer:
          "Live research attempted free public search (DuckDuckGo HTML, Bing HTML, Reddit JSON, CPSC) including scam/fake-review queries. Little or nothing product-specific came back. No reviews or URLs were invented.",
      });
    }

    let gotchas = buildGotchas(relevant);
    const honestyExtras = buildHonestyGotchas(relevant, {
      price,
      title: cleanTitle,
      tokens,
    });
    for (const g of honestyExtras) {
      if (!gotchas.some((x) => x.type === g.type || x.title === g.title)) {
        gotchas.push(g);
      }
    }

    // If a recall snippet names a specific model, surface that as its own gotcha
    if (gotchas.some((g) => /recall/i.test(g.title))) {
      for (const hit of relevant) {
        const blob = `${hit.title} ${hit.snippet}`;
        const m = blob.match(/model[:\s]+([A-Z0-9-]{3,})/i);
        if (m && /recall|safety/i.test(blob)) {
          gotchas.push({
            title: `Recall may be model-specific (${m[1]})`,
            detail: `A fetched recall/safety snippet names model ${m[1]}. Confirm whether your unit matches before assuming the whole product line is clear or condemned.`,
            sourceUrls: [hit.url],
            type: "recall",
          });
          break;
        }
      }
    }

    // If we have discussion but no negative themes, note sparse red flags honestly
    if (gotchas.length === 0) {
      const sample = relevant.filter((h) => !isLikelyMarketing(h.url, h.title)).slice(0, 2);
      if (sample.length) {
        gotchas.push({
          title: "No strong red-flag cluster in snippets",
          detail: `Independent hits turned up (e.g. “${(sample[0].title || "").slice(0, 80)}”) without clear recall/scam/failure language in the snippets we parsed. That is not a guarantee — only what this pass saw.`,
          sourceUrls: sample.map((s) => s.url),
        });
      }
    }

    gotchas = gotchas.slice(0, 5);
    const sources = buildSources(relevant, url || null);
    const honesty = buildHonestyFlags(relevant, gotchas, true);
    // Recompute thinEvidence after we know we have relevant hits
    if (relevant.length >= 2 && honesty.independentSources) {
      honesty.thinEvidence = false;
    }
    const { verdict, summary } = decideVerdict(relevant, gotchas, honesty);

    return attachVerdictLabels({
      verdict,
      summary,
      gotchas,
      sources,
      researched: true,
      honesty,
      disclaimer:
        "Research used free public search snippets (DuckDuckGo when allowed, Bing, Reddit JSON when allowed, CPSC), including scam and fake-review queries. Snippets can be incomplete or mismatched to a specific SKU. Not legal, safety, or financial advice.",
      _debug: {
        queryCount: queries.length,
        rawHits: deduped.length,
        relevantHits: relevant.length,
        brandBit: brandBit || null,
      },
    });
  }
}

module.exports = {
  researchProduct,
  USER_AGENT,
  VERDICT_LABELS,
  attachVerdictLabels,
};
