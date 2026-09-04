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

async function fetchMetadata(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
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
    if (!res.ok) {
      return {
        ok: false,
        error: `Page returned HTTP ${res.status}`,
        status: res.status,
      };
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const title =
      pickMeta($, "og:title", "twitter:title") ||
      $("title").first().text().trim() ||
      null;
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
      title: title || null,
      image: image || null,
      price: price || null,
      description: desc || null,
      siteName: siteName || null,
      finalUrl: res.url || targetUrl,
    };
  } catch (err) {
    const msg =
      err.name === "AbortError"
        ? "Timed out reading the page"
        : err.message || "Could not reach the page";
    return { ok: false, error: msg };
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
    if (fetched.ok) {
      meta = {
        ok: true,
        title: fetched.title || manualTitle || null,
        price: fetched.price,
        image: fetched.image,
        description: fetched.description,
        siteName: fetched.siteName,
        finalUrl: fetched.finalUrl,
        error: null,
      };
    } else {
      meta.error = fetched.error;
      meta.title = manualTitle || null;
      meta.finalUrl = rawUrl;
    }
  }

  const title = meta.title || manualTitle || null;
  if (!title) {
    return res.status(400).json({
      ok: false,
      error: meta.error
        ? `Could not read the page (${meta.error}). Enter a manual title to research.`
        : "Need a product title — paste a URL we can read or enter a manual title.",
    });
  }

  let analysis;
  try {
    analysis = await researchProduct({
      title,
      url: meta.finalUrl || rawUrl || null,
      price: meta.price,
      siteName: meta.siteName || null,
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
    title: title || "Untitled product",
    price: meta.price,
    image: meta.image,
    fetchFailed: Boolean(parsed) && !meta.ok,
    fetchError: meta.error,
    ...analysis,
    fetched: {
      title: meta.title,
      price: meta.price,
      image: meta.image,
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
