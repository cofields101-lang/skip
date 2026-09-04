const express = require("express");
const path = require("path");
const fs = require("fs");
const cheerio = require("cheerio");
const { researchProduct, attachVerdictLabels } = require("./research");

const app = express();
const PORT = process.env.PORT || 3847;
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const WAITLIST_FILE = path.join(DATA_DIR, "waitlist.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(WAITLIST_FILE)) fs.writeFileSync(WAITLIST_FILE, "[]\n");

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(ROOT, "public")));

const EXAMPLE = attachVerdictLabels({
  id: "example-carry-on",
  isExample: true,
  url: "https://example.com/demo/travel-carry-on",
  title: "AeroLite Pro Travel Carry-On (22\")",
  price: "$180",
  image: null,
  verdict: "Wait",
  summary:
    "Looks polished on the page. The demo gotchas below are fabricated so you can see how Skip reads — not real research.",
  gotchas: [
    {
      title: "Example data, not a real review",
      detail:
        "This entire check is a fixture. Do not treat it as product advice.",
    },
    {
      title: "Wheel warranty looks generous — until you read the fine print",
      detail:
        "Demo note: many carry-ons exclude curb damage and airline handling from 'lifetime' coverage.",
    },
    {
      title: "Weight listed without battery / power bank",
      detail:
        "Demo note: page weight often omits the USB battery that ships in the box.",
    },
    {
      title: "Photo set is studio-only",
      detail:
        "Demo note: no packed-full shots, no airport-size comparison. Hard to judge real capacity.",
    },
  ],
  sources: [
    {
      label: "Product page (demo URL)",
      url: "https://example.com/demo/travel-carry-on",
      note: "Fixture — not a live product page.",
    },
  ],
  fetched: {
    title: "AeroLite Pro Travel Carry-On (22\")",
    price: "$180",
    image: null,
  },
  researched: false,
  honesty: {
    independentSources: false,
    scamMentions: false,
    recallMentions: false,
    thinEvidence: true,
  },
  disclaimer:
    "EXAMPLE CHECK. Gotchas and verdict are demo content so the product feel is visible. Not live research.",
});

function loadWaitlist() {
  try {
    return JSON.parse(fs.readFileSync(WAITLIST_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveWaitlist(list) {
  fs.writeFileSync(WAITLIST_FILE, JSON.stringify(list, null, 2) + "\n");
}

function pickMeta($, ...keys) {
  for (const key of keys) {
    const byProp = $(`meta[property="${key}"]`).attr("content");
    if (byProp) return byProp.trim();
    const byName = $(`meta[name="${key}"]`).attr("content");
    if (byName) return byName.trim();
  }
  return null;
}

function extractPrice(text) {
  if (!text) return null;
  const m = String(text).match(
    /(?:USD|US\$|\$|€|£)\s?[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?\s?(?:USD|EUR|GBP)/i
  );
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

const JUNK_SITE_TITLES = new Set([
  "amazon",
  "amazon.com",
  "amazon.co.uk",
  "amazon.ca",
  "amazon.de",
  "walmart",
  "walmart.com",
  "ebay",
  "ebay.com",
  "target",
  "target.com",
  "best buy",
  "bestbuy",
  "bestbuy.com",
  "etsy",
  "etsy.com",
  "aliexpress",
  "temu",
  "shopify",
]);

function normalizeTitleCandidate(raw) {
  if (!raw) return null;
  let t = String(raw).replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Strip Amazon.com: prefix (common when bots get a soft interstitial)
  t = t.replace(/^Amazon\.com\s*[:\-–—]\s*/i, "");
  t = t.replace(/^Amazon\.[a-z.]{2,6}\s*[:\-–—]\s*/i, "");
  // Strip trailing marketplace / breadcrumb tails
  t = t
    .replace(/\s*[:|–—-]\s*Amazon\.com.*$/i, "")
    .replace(/\s*[:|–—-]\s*Amazon\.ca.*$/i, "")
    .replace(/\s*[:|–—-]\s*Amazon\.co\.uk.*$/i, "")
    .replace(/\s*[:|–—-]\s*Walmart\.com.*$/i, "")
    .replace(/\s*[:|–—-]\s*Home\s*&\s*Kitchen\s*$/i, "")
    .replace(/\s*[:|–—-]\s*Sports\s*&\s*Outdoors\s*$/i, "")
    .replace(/\s*[:|–—-]\s*Electronics\s*$/i, "")
    .replace(/\s+at\s+Amazon\.com.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
}

/** Shorter research query from a long Amazon SEO title */
function compactSearchTitle(title, slugTitle) {
  const cleaned = normalizeTitleCandidate(title) || title || "";
  if (slugTitle && slugTitle.length >= 12) {
    // Prefer slug words when they overlap the cleaned title (more searchable)
    const slugL = slugTitle.toLowerCase();
    const cleanL = cleaned.toLowerCase();
    const slugWords = slugTitle.split(/\s+/).filter((w) => w.length >= 4);
    const overlap = slugWords.filter((w) => cleanL.includes(w.toLowerCase())).length;
    if (overlap >= 2 || /quencher|tumbler|stanley|powercore|anker/i.test(slugL + cleanL)) {
      // Blend: if cleaned has a known brand word missing from slug, prepend it
      let out = slugTitle;
      if (/\bstanley\b/i.test(cleaned) && !/\bstanley\b/i.test(out)) {
        out = "Stanley " + out;
      }
      if (/\banker\b/i.test(cleaned) && !/\banker\b/i.test(out)) {
        out = "Anker " + out;
      }
      return out.replace(/\s+/g, " ").trim();
    }
  }
  // Truncate huge SEO titles at first pipe / reasonable length
  let t = cleaned.split("|")[0].split(":")[0].trim();
  if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, "").trim();
  return t || cleaned || slugTitle || null;
}

function isJunkProductTitle(title) {
  if (!title) return true;
  const t = String(title).replace(/\s+/g, " ").trim();
  if (t.length < 8) return true;
  const lower = t.toLowerCase();
  if (JUNK_SITE_TITLES.has(lower)) return true;
  // Brand-only / site-name-only patterns
  if (/^amazon(\.com)?$/i.test(t)) return true;
  if (/^(shop|store|home|official\s+store)$/i.test(t)) return true;
  // Very short single-token site names
  if (!/\s/.test(t) && t.length < 12 && /amazon|walmart|ebay|target|etsy/i.test(t)) {
    return true;
  }
  return false;
}

function parseAmazonAsinAndSlug(urlString) {
  try {
    const u = new URL(urlString);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!/(^|\.)amazon\./i.test(host)) return { asin: null, slugTitle: null };
    const path = u.pathname || "";
    let asin = null;
    let slug = null;
    // /Slug-Words/dp/ASIN or /dp/ASIN or /gp/product/ASIN
    let m = path.match(/\/([^/]+)\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (m) {
      slug = m[1];
      asin = m[2].toUpperCase();
    } else {
      m = path.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (m) asin = m[1].toUpperCase();
    }
    // Also check query asin=
    if (!asin) {
      const q = u.searchParams.get("asin") || u.searchParams.get("ASIN");
      if (q && /^[A-Z0-9]{10}$/i.test(q)) asin = q.toUpperCase();
    }
    // /clp/ASIN style redirects — no slug
    if (!asin) {
      m = path.match(/\/(?:clp|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (m) asin = m[1].toUpperCase();
    }
    let slugTitle = null;
    if (slug && !/^(dp|gp|product|clp)$/i.test(slug)) {
      // Drop trailing ref-like noise; keep readable words
      const words = slug
        .replace(/_/g, "-")
        .split("-")
        .map((w) => w.trim())
        .filter((w) => w && !/^(ref|dp|gp)$/i.test(w) && !/^[A-Z0-9]{10}$/i.test(w));
      if (words.length >= 2) {
        slugTitle = words.join(" ");
      }
    }
    return { asin, slugTitle };
  } catch {
    return { asin: null, slugTitle: null };
  }
}

function extractJsonLdProductName($) {
  const names = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text() || $(el).html() || "";
    if (!raw.trim()) return;
    try {
      const data = JSON.parse(raw);
      const stack = Array.isArray(data) ? [...data] : [data];
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        const type = node["@type"];
        const types = Array.isArray(type) ? type : type ? [type] : [];
        const isProduct = types.some((t) => /product/i.test(String(t)));
        if (isProduct && node.name) {
          const n = Array.isArray(node.name) ? node.name[0] : node.name;
          if (typeof n === "string" && n.trim()) names.push(n.trim());
        }
        if (node["@graph"]) {
          const g = Array.isArray(node["@graph"]) ? node["@graph"] : [node["@graph"]];
          stack.push(...g);
        }
      }
    } catch {
      /* ignore bad JSON-LD */
    }
  });
  return names[0] || null;
}

function pickBestTitle(candidates) {
  const scored = [];
  for (const c of candidates) {
    const t = normalizeTitleCandidate(c);
    if (!t) continue;
    if (isJunkProductTitle(t)) continue;
    // Prefer longer, multi-word titles
    const words = t.split(/\s+/).length;
    const score = t.length + words * 8;
    scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.t || null;
}

async function fetchMetadata(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const { asin: urlAsin, slugTitle: urlSlugTitle } = parseAmazonAsinAndSlug(targetUrl);
  try {
    const res = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "SkipBot/0.3 (+local research)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const finalUrl = res.url || targetUrl;
    // Re-parse ASIN/slug from final URL (Amazon may redirect /dp/... → /clp/...)
    const fromFinal = parseAmazonAsinAndSlug(finalUrl);
    // Prefer original-path slug when redirect drops it (e.g. → /clp/ASIN)
    const asin = fromFinal.asin || urlAsin || null;
    const slugTitle = urlSlugTitle || fromFinal.slugTitle || null;

    if (!res.ok) {
      const fallbackTitle = pickBestTitle([slugTitle]) || slugTitle || null;
      return {
        ok: false,
        error: `Page returned HTTP ${res.status}`,
        status: res.status,
        title: fallbackTitle,
        asin,
        searchTitle: fallbackTitle,
        slugTitle,
        finalUrl,
      };
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const ogTitle = pickMeta($, "og:title", "twitter:title");
    const docTitle = $("title").first().text().trim() || null;
    const metaNameTitle = $('meta[name="title"]').attr("content") || null;
    const productTitleEl =
      $("#productTitle").first().text().trim() ||
      $("#title").first().text().trim() ||
      $('[data-feature-name="title"] #productTitle').first().text().trim() ||
      null;
    const jsonLdName = extractJsonLdProductName($);

    const rawBest =
      pickBestTitle([productTitleEl, jsonLdName, metaNameTitle, ogTitle, docTitle, slugTitle]) ||
      (slugTitle && !isJunkProductTitle(slugTitle) ? slugTitle : null) ||
      normalizeTitleCandidate(ogTitle) ||
      normalizeTitleCandidate(docTitle) ||
      slugTitle ||
      null;
    // Prefer a human title: cleaned meta if good, else slug-compacted
    let bestTitle = normalizeTitleCandidate(rawBest) || rawBest;
    if (bestTitle && bestTitle.length > 120 && slugTitle) {
      bestTitle = compactSearchTitle(bestTitle, slugTitle) || bestTitle;
    }

    // searchTitle: prefer compact slug/product wording for research queries
    const pickedForSearch =
      pickBestTitle([productTitleEl, jsonLdName, slugTitle, metaNameTitle, ogTitle, docTitle]) ||
      bestTitle;
    const searchTitle = compactSearchTitle(pickedForSearch || bestTitle, slugTitle);

    const image =
      pickMeta($, "og:image", "twitter:image") ||
      $('link[rel="image_src"]').attr("href") ||
      null;
    const desc =
      pickMeta($, "og:description", "description", "twitter:description") ||
      null;
    const price =
      pickMeta(
        $,
        "og:price:amount",
        "product:price:amount",
        "twitter:data1"
      ) ||
      extractPrice(
        $('[itemprop="price"]').attr("content") ||
          $('[itemprop="price"]').text() ||
          $('[class*="price"]').first().text() ||
          desc ||
          ""
      );
    const siteName = pickMeta($, "og:site_name");
    return {
      ok: true,
      title: bestTitle || null,
      image: image || null,
      price: price || null,
      description: desc || null,
      siteName: siteName || null,
      finalUrl,
      asin,
      searchTitle: searchTitle || bestTitle || null,
      slugTitle,
      amazonBlocked:
        Boolean(asin) &&
        (isJunkProductTitle(normalizeTitleCandidate(ogTitle) || ogTitle) ||
          isJunkProductTitle(normalizeTitleCandidate(docTitle) || docTitle)) &&
        Boolean(slugTitle),
    };
  } catch (err) {
    const msg =
      err.name === "AbortError"
        ? "Timed out reading the page"
        : err.message || "Could not reach the page";
    const fallbackTitle = pickBestTitle([urlSlugTitle]) || urlSlugTitle || null;
    return {
      ok: false,
      error: msg,
      title: fallbackTitle,
      asin: urlAsin || null,
      searchTitle: fallbackTitle,
      slugTitle: urlSlugTitle || null,
      finalUrl: targetUrl,
    };
  } finally {
    clearTimeout(timer);
  }
}

app.get("/api/example", (_req, res) => {
  res.json(EXAMPLE);
});

app.post("/api/waitlist", (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "Need a real email." });
  }
  const list = loadWaitlist();
  if (!list.find((e) => e.email === email)) {
    list.push({ email, at: new Date().toISOString() });
    saveWaitlist(list);
  }
  res.json({ ok: true, message: "You're on the list." });
});

app.get("/api/waitlist", (_req, res) => {
  res.json({ ok: true, count: loadWaitlist().length });
});

app.post("/api/check", async (req, res) => {
  const rawUrl = String(req.body?.url || "").trim();
  const manualTitle = String(req.body?.manualTitle || "").trim();
  const exampleId = req.body?.exampleId;

  if (exampleId === "example-carry-on" || rawUrl.includes("example.com/demo/travel-carry-on")) {
    return res.json({ ok: true, result: EXAMPLE });
  }

  if (!rawUrl && !manualTitle) {
    return res.status(400).json({ ok: false, error: "Paste a product URL or enter a manual title." });
  }

  let parsed;
  if (rawUrl) {
    try {
      parsed = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return res.status(400).json({ ok: false, error: "URL must be http(s)." });
      }
    } catch {
      return res.status(400).json({ ok: false, error: "That doesn't look like a URL." });
    }
  }

  let meta = {
    ok: false,
    title: manualTitle || null,
    price: null,
    image: null,
    finalUrl: rawUrl || null,
    error: null,
  };

  if (parsed) {
    const fetched = await fetchMetadata(parsed.toString());
    // Always carry ASIN / slug-derived title even when fetch "ok" but title was junk
    const amazonBits = parseAmazonAsinAndSlug(parsed.toString());
    if (fetched.ok) {
      const chosenTitle =
        (fetched.title && !isJunkProductTitle(fetched.title) ? fetched.title : null) ||
        (manualTitle && !isJunkProductTitle(manualTitle) ? manualTitle : null) ||
        fetched.searchTitle ||
        fetched.slugTitle ||
        fetched.title ||
        manualTitle ||
        null;
      meta = {
        ok: true,
        title: chosenTitle,
        price: fetched.price,
        image: fetched.image,
        description: fetched.description,
        siteName: fetched.siteName,
        finalUrl: fetched.finalUrl,
        error: null,
        asin: fetched.asin || amazonBits.asin || null,
        searchTitle:
          fetched.searchTitle ||
          chosenTitle ||
          fetched.slugTitle ||
          amazonBits.slugTitle ||
          null,
        slugTitle: fetched.slugTitle || amazonBits.slugTitle || null,
        amazonBlocked: Boolean(fetched.amazonBlocked),
      };
    } else {
      meta.error = fetched.error;
      meta.title =
        (manualTitle && !isJunkProductTitle(manualTitle) ? manualTitle : null) ||
        fetched.title ||
        fetched.slugTitle ||
        amazonBits.slugTitle ||
        manualTitle ||
        null;
      meta.finalUrl = fetched.finalUrl || rawUrl;
      meta.asin = fetched.asin || amazonBits.asin || null;
      meta.searchTitle =
        fetched.searchTitle ||
        meta.title ||
        fetched.slugTitle ||
        amazonBits.slugTitle ||
        null;
      meta.slugTitle = fetched.slugTitle || amazonBits.slugTitle || null;
      meta.amazonBlocked = Boolean(meta.asin);
    }
  } else if (rawUrl) {
    const amazonBits = parseAmazonAsinAndSlug(rawUrl);
    if (amazonBits.asin || amazonBits.slugTitle) {
      meta.asin = amazonBits.asin;
      meta.slugTitle = amazonBits.slugTitle;
      if (!meta.title || isJunkProductTitle(meta.title)) {
        meta.title = manualTitle || amazonBits.slugTitle || meta.title;
      }
      meta.searchTitle = meta.title || amazonBits.slugTitle;
    }
  }

  const title = meta.title || manualTitle || null;
  if (!title || isJunkProductTitle(title)) {
    // Last chance: Amazon slug from URL even if meta failed entirely
    if (parsed) {
      const bits = parseAmazonAsinAndSlug(parsed.toString());
      if (bits.slugTitle) {
        meta.title = bits.slugTitle;
        meta.searchTitle = bits.slugTitle;
        meta.asin = meta.asin || bits.asin;
      }
    }
  }
  const resolvedTitle = meta.title || manualTitle || null;
  if (!resolvedTitle) {
    return res.status(400).json({
      ok: false,
      error: meta.error
        ? `Could not read the page (${meta.error}). Enter a manual title to research.`
        : "Need a product title — paste a URL we can read or enter a manual title.",
    });
  }

  let analysis;
  try {
    const researchQuery =
      compactSearchTitle(meta.searchTitle || resolvedTitle, meta.slugTitle) ||
      meta.searchTitle ||
      resolvedTitle;
    analysis = await researchProduct({
      title: compactSearchTitle(resolvedTitle, meta.slugTitle) || resolvedTitle,
      searchTitle: researchQuery,
      url: meta.finalUrl || rawUrl || null,
      price: meta.price,
      siteName: meta.siteName || null,
      asin: meta.asin || null,
      slugTitle: meta.slugTitle || null,
      amazonBlocked: Boolean(meta.amazonBlocked),
    });
  } catch (err) {
    analysis = attachVerdictLabels({
      verdict: "Wait",
      summary: "Research pipeline errored; not inventing results.",
      gotchas: [
        {
          title: "Research failed to finish",
          detail: String(err.message || err),
          sourceUrls: [],
        },
      ],
      sources: meta.finalUrl
        ? [
            {
              label: "Product page (fetched)",
              url: meta.finalUrl,
              note: "Public HTML metadata only.",
            },
          ]
        : [],
      researched: false,
      honesty: {
        independentSources: false,
        scamMentions: false,
        recallMentions: false,
        thinEvidence: true,
      },
      disclaimer:
        "Research threw an error. Metadata may still be shown. No invented reviews.",
    });
  }

  // Strip internal debug before responding
  if (analysis && analysis._debug) delete analysis._debug;

  // Ensure plain-language fields always present
  analysis = attachVerdictLabels(analysis || {});

  const result = {
    id: `check-${Date.now()}`,
    isExample: false,
    url: meta.finalUrl || rawUrl || null,
    title: (compactSearchTitle(resolvedTitle, meta.slugTitle) || resolvedTitle) || "Untitled product",
    price: meta.price,
    image: meta.image,
    fetchFailed: Boolean(parsed) && !meta.ok,
    fetchError: meta.error,
    asin: meta.asin || null,
    ...analysis,
    fetched: {
      title: meta.title,
      price: meta.price,
      image: meta.image,
      asin: meta.asin || null,
      searchTitle: meta.searchTitle || null,
    },
  };

  res.json({ ok: true, result });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(ROOT, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Skip running at http://localhost:${PORT}`);
});
