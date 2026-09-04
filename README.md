# Skip

**Honest reviews — not scams.** Paste a URL. Get Good to buy / Not clear yet / Don't buy (Buy/Wait/Skip under the hood) plus real gotchas.

Price: **$9/month**, unlimited checks.

## Run

```bash
cd /workspace/skip
npm install
npm start
```

Then open **http://localhost:3847**

Optional: `PORT=3000 npm start`

Restart after server changes:

```bash
pkill -f 'node.*skip' || true
cd /workspace/skip && npm start
```

## What you get

- **Landing** — copy, 3-step how-it-works, $9/mo pricing, waitlist (saved to `data/waitlist.json` + browser localStorage)
- **Checker** — paste Amazon/Shopify/other product URL; server fetches public OG/meta title, image, price when possible
- **Research pipeline (v0.3)** — after metadata, searches public sources for complaints/problems and scores **Buy / Wait / Skip**
- **Result** — plain-language verdict (Good to buy / Not clear yet / Don't buy), one-line reason, Honesty check badges, gotchas, sources
- **Example fixture** — labeled **Example** carry-on demo (unchanged, not live research)
- **History** — past checks in `localStorage`

## Research pipeline

Implemented in `server/research.js` and called from `POST /api/check`:

1. Use product **title** (from OG metadata or `manualTitle`) plus brand/site when available.
2. Query free sources in parallel (`Promise.allSettled`, ~18s overall cap):
   - DuckDuckGo HTML: `https://html.duckduckgo.com/html/?q=…` (queries like `"Title" review problems`, complaints / "don't buy", reddit)
   - Bing HTML search as a practical fallback when DDG challenges bots
   - Reddit public JSON: `https://www.reddit.com/search.json?…` (User-Agent required; often blocked)
   - CPSC recalls search pages when reachable
3. Parse titles, snippets, and URLs; dedupe; keep hits that mention the product (or a clear variant).
4. Extract **3-5 gotchas** only from those snippets, each citing real source URLs we fetched.
5. Score verdict:
   - **Skip** — multiple independent serious failures, safety issues, or scam/recall patterns
   - **Buy** — mostly positive or sparse-but-benign, some real discussion, no strong red flags
   - **Wait** — thin, mixed, marketing-only, or almost nothing usable

User-Agent: `SkipBot/0.3 (+local research)`. Blocks/timeouts are handled without inventing data.

You can research on **title alone** when URL fetch fails: `POST /api/check` with `{"manualTitle":"Anker PowerCore 10000"}`.

## Plain-language API fields

- `verdict`: Buy | Wait | Skip
- `verdictLabel`: Good to buy | Not clear yet | Don't buy
- `reason`: one-line reason
- `honesty`: independentSources, scamMentions, recallMentions, thinEvidence

## Honest limits

- **No invented reviews, quotes, ratings, or URLs** — only what the pipeline actually fetched.
- Search engines and Reddit frequently bot-check or rate-limit; coverage varies by product and network.
- Snippets can refer to a **related SKU** or older generation — always open the cited links.
- Live URL checks still pull **public HTML metadata** (title / price / image) when the page allows it.
- Waitlist is local file + localStorage only (no email provider).

## Stack

Node + Express + Cheerio. Static frontend in `public`/. No paid APIs required.
