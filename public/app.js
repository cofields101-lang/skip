(() => {
  const HISTORY_KEY = "skip.history.v1";
  const WAITLIST_KEY = "skip.waitlist.local";
  const app = document.getElementById("app");

  const VERDICT_LABELS = {
    Buy: "Good to buy",
    Wait: "Not clear yet",
    Skip: "Don't buy",
  };

  function verdictLabel(result) {
    if (result?.verdictLabel) return result.verdictLabel;
    return VERDICT_LABELS[result?.verdict] || VERDICT_LABELS.Wait;
  }

  function verdictReason(result) {
    if (result?.reason) return result.reason;
    const s = String(result?.summary || "").replace(/\s+/g, " ").trim();
    if (!s) return "Paste a URL, get a blunt good-or-bad call.";
    const first = s.split(/(?<=[.!?])\s+/)[0] || s;
    return first.length > 160 ? first.slice(0, 157) + "…" : first;
  }

  function route() {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/") return renderLanding();
    if (path === "/check") return renderChecker();
    if (path === "/result") return renderResult();
    return renderLanding();
  }

  function navigate(path) {
    history.pushState({}, "", path);
    route();
    window.scrollTo(0, 0);
  }

  window.addEventListener("popstate", route);

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute("href"));
  });

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveHistory(items) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
  }

  function pushHistory(result) {
    const items = loadHistory().filter((x) => x.id !== result.id);
    items.unshift({
      id: result.id,
      title: result.title,
      verdict: result.verdict,
      verdictLabel: verdictLabel(result),
      price: result.price,
      url: result.url,
      isExample: !!result.isExample,
      at: new Date().toISOString(),
      result,
    });
    saveHistory(items);
  }

  function storeCurrent(result) {
    sessionStorage.setItem("skip.current", JSON.stringify(result));
    pushHistory(result);
  }

  function readCurrent() {
    try {
      return JSON.parse(sessionStorage.getItem("skip.current") || "null");
    } catch {
      return null;
    }
  }

  function header(active) {
    return `
      <header class="site-header wrap">
        <a class="logo" href="/" data-link>Skip <span>v0.3</span></a>
        <nav class="nav">
          <a href="/check" data-link ${active === "check" ? 'aria-current="page"' : ""}>Checker</a>
          <a class="btn btn-accent" href="/check" data-link>Run a check</a>
        </nav>
      </header>
    `;
  }

  function footer() {
    return `
      <footer class="site-footer wrap">
        <div>Skip · honest reviews, not scams. Paste a URL — good or bad — then buy.</div>
        <div>$9/mo · unlimited checks · local waitlist for now</div>
      </footer>
    `;
  }

  function renderLanding() {
    app.innerHTML = `
      ${header("home")}
      <main>
        <section class="hero wrap">
          <div>
            <p class="eyebrow">Honest reviews — not scams</p>
            <h1>Paste a URL.<br /><em>Good or bad.</em> Done.</h1>
            <p class="lede">
              An app where people see honest reviews and not scams. Paste a product URL —
              Skip tells you Good to buy, Not clear yet, or Don't buy — then you buy (or don't).
            </p>
            <div class="hero-actions">
              <a class="btn btn-accent" href="/check" data-link>Check a product</a>
              <a class="btn btn-ghost" href="#how">How it works</a>
            </div>
            <div class="price-pill"><strong>$9/mo</strong> unlimited checks. No credits theater.</div>
          </div>
          <aside class="hero-card" aria-label="Example check">
            <div class="tag">Example</div>
            <h2>AeroLite Pro Travel Carry-On</h2>
            <div class="meta">$180 · demo fixture, not live research</div>
            <div class="verdict-chip wait">Not clear yet</div>
            <div class="mini-gotcha">
              <strong>Example data, not a real review.</strong>
              Wheel warranty fine print, missing packed photos, weight without the battery — the kind of friction a listing buries.
            </div>
            <div style="margin-top:1rem">
              <a class="btn btn-block" href="/check?example=1" data-link>Open example check</a>
            </div>
          </aside>
        </section>

        <section class="wrap" id="how">
          <h2 class="section-title">How it works</h2>
          <p class="section-sub">Paste. Get a blunt call. Buy only when it's clear.</p>
          <div class="steps">
            <article class="step">
              <div class="n">01</div>
              <h3>Paste the URL</h3>
              <p>Amazon, Shopify, brand site — whatever you're about to buy.</p>
            </article>
            <article class="step">
              <div class="n">02</div>
              <h3>We hunt for honesty</h3>
              <p>Public complaints, scam mentions, fake-review chatter, recalls — not the listing's own hype.</p>
            </article>
            <article class="step">
              <div class="n">03</div>
              <h3>Good or bad — then buy</h3>
              <p>A big plain-language verdict, one-line reason, gotchas, and sources. No invented star ratings.</p>
            </article>
          </div>
        </section>

        <section class="wrap" id="pricing">
          <h2 class="section-title">Pricing</h2>
          <p class="section-sub">One plan. Unlimited checks. Cancel when you're done shopping.</p>
          <div class="pricing">
            <div class="price-card">
              <p class="eyebrow" style="margin:0">Monthly</p>
              <div class="amount">$9 <span>/ month</span></div>
              <ul>
                <li>Unlimited product checks</li>
                <li>Honesty check for scam &amp; fake-review signals</li>
                <li>History on your device</li>
                <li>No review theater, no fake quotes</li>
              </ul>
              <a class="btn btn-accent" href="/check" data-link>Start checking</a>
            </div>
            <div class="waitlist-card">
              <h3>Want launch updates?</h3>
              <p>Drop your email. Stored on this machine in a local JSON file — not sold, not emailed to a third-party ESP in this build.</p>
              <form id="waitlist-form">
                <div class="field-row inline">
                  <input type="email" name="email" placeholder="you@example.com" required autocomplete="email" />
                  <button class="btn" type="submit">Join waitlist</button>
                </div>
                <p class="form-note">Also saved in your browser for this demo.</p>
                <div class="form-msg" id="waitlist-msg" hidden></div>
              </form>
            </div>
          </div>
        </section>
      </main>
      ${footer()}
    `;

    const form = document.getElementById("waitlist-form");
    const msg = document.getElementById("waitlist-msg");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = new FormData(form).get("email").toString().trim();
      msg.hidden = false;
      msg.className = "form-msg";
      try {
        const local = JSON.parse(localStorage.getItem(WAITLIST_KEY) || "[]");
        if (!local.includes(email)) {
          local.push(email);
          localStorage.setItem(WAITLIST_KEY, JSON.stringify(local));
        }
        const res = await fetch("/api/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not save");
        msg.classList.add("ok");
        msg.textContent = data.message || "You're on the list.";
        form.reset();
      } catch (err) {
        msg.classList.add("err");
        msg.textContent = err.message || "Something broke. Try again.";
      }
    });
  }

  function historyBlock() {
    const items = loadHistory();
    if (!items.length) {
      return `<div class="history"><h2>History</h2><p class="empty">No checks yet. They stay in localStorage on this device.</p></div>`;
    }
    return `
      <div class="history">
        <h2>History</h2>
        <ul class="history-list">
          ${items
            .map(
              (item) => `
            <li data-history-id="${item.id}">
              <div>
                <div class="h-title">${escapeHtml(item.title)}</div>
                <div class="h-meta">${item.price ? escapeHtml(item.price) + " · " : ""}${formatWhen(item.at)}</div>
              </div>
              <span class="badge ${item.isExample ? "example" : (item.verdict || "Wait").toLowerCase()}">${
                item.isExample
                  ? "Example"
                  : escapeHtml(item.verdictLabel || VERDICT_LABELS[item.verdict] || item.verdict)
              }</span>
            </li>`
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  function renderChecker() {
    const wantsExample = new URLSearchParams(location.search).get("example") === "1";
    app.innerHTML = `
      ${header("check")}
      <main class="wrap">
        <div class="page-head">
          <h1>Checker</h1>
          <p>Paste a product URL. We'll look for honest public signal — scams, fake reviews, recalls — and give you a blunt good-or-bad call.</p>
        </div>

        <div class="example-banner">
          <div>
            <strong>Example</strong>
            <p>AeroLite Pro Travel Carry-On · $180 · fixture data only</p>
          </div>
          <button class="btn" type="button" id="run-example">Run example</button>
        </div>

        <div class="checker-panel">
          <form id="check-form">
            <label class="label" for="url">Product URL</label>
            <input id="url" name="url" type="url" placeholder="https://www.amazon.com/... or any product page" autocomplete="url" />
            <div class="manual-box" id="manual-box">
              <label class="label" for="manualTitle">Manual title (if fetch fails)</label>
              <input id="manualTitle" name="manualTitle" type="text" placeholder="What is the product called?" />
            </div>
            <div style="margin-top:0.9rem; display:flex; gap:0.6rem; flex-wrap:wrap;">
              <button class="btn btn-accent" type="submit" id="submit-btn">Is it good or bad?</button>
              <button class="btn btn-ghost" type="button" id="toggle-manual">Enter title manually</button>
            </div>
            <div class="form-msg" id="check-msg" hidden></div>
          </form>
        </div>

        ${historyBlock()}
      </main>
      ${footer()}
    `;

    const form = document.getElementById("check-form");
    const msg = document.getElementById("check-msg");
    const manualBox = document.getElementById("manual-box");
    const submitBtn = document.getElementById("submit-btn");

    document.getElementById("toggle-manual").addEventListener("click", () => {
      manualBox.classList.toggle("show");
    });

    document.getElementById("run-example").addEventListener("click", () => runCheck({ exampleId: "example-carry-on" }));

    document.querySelectorAll("[data-history-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.getAttribute("data-history-id");
        const item = loadHistory().find((x) => x.id === id);
        if (item?.result) {
          storeCurrent(item.result);
          navigate("/result");
        }
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      await runCheck({
        url: fd.get("url")?.toString().trim(),
        manualTitle: fd.get("manualTitle")?.toString().trim(),
      });
    });

    async function runCheck(payload) {
      msg.hidden = true;
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<span class="spinner"></span> Researching…`;
      try {
        const res = await fetch("/api/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "Check failed");
        storeCurrent(data.result);
        navigate("/result");
      } catch (err) {
        msg.hidden = false;
        msg.className = "form-msg err";
        msg.textContent = err.message || "Could not check that URL.";
        manualBox.classList.add("show");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Is it good or bad?";
      }
    }

    if (wantsExample) {
      runCheck({ exampleId: "example-carry-on" });
    }
  }

  function honestyStrip(result) {
    const h = result.honesty || {};
    const badges = [];
    if (h.independentSources) {
      badges.push({ key: "independent", label: "Independent sources", tone: "good" });
    }
    if (h.scamMentions) {
      badges.push({ key: "scam", label: "Scam mentions", tone: "bad" });
    }
    if (h.recallMentions) {
      badges.push({ key: "recall", label: "Recall mentions", tone: "bad" });
    }
    if (h.thinEvidence) {
      badges.push({ key: "thin", label: "Thin evidence", tone: "warn" });
    }
    if (!badges.length) return "";
    return `
      <div class="honesty-strip" aria-label="Honesty check">
        <div class="honesty-label">Honesty check</div>
        <div class="honesty-badges">
          ${badges
            .map(
              (b) =>
                `<span class="honesty-badge ${b.tone}">${escapeHtml(b.label)}</span>`
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function renderResult() {
    const result = readCurrent();
    if (!result) {
      app.innerHTML = `
        ${header("check")}
        <main class="wrap page-head">
          <h1>No result yet</h1>
          <p>Run a check first.</p>
          <p style="margin-top:1rem"><a class="btn btn-accent" href="/check" data-link>Go to checker</a></p>
        </main>
        ${footer()}
      `;
      return;
    }

    const v = (result.verdict || "Wait").toLowerCase();
    const label = verdictLabel(result);
    const reason = verdictReason(result);
    const thumb = result.image
      ? `<img class="product-thumb" src="${escapeAttr(result.image)}" alt="" referrerpolicy="no-referrer" />`
      : `<div class="product-thumb placeholder">No image</div>`;

    const fetchAlert = result.fetchFailed
      ? `<div class="alert"><strong>Couldn't read this page.</strong> ${escapeHtml(
          result.fetchError || "The site blocked or timed out our fetch."
        )} You can still treat the verdict as a placeholder and re-check with a manual title.</div>`
      : "";

    const researchNote = result.isExample
      ? ""
      : result.researched
        ? `<div class="alert"><strong>Researched.</strong> Public web/search snippets were queried for complaints, scams, fake reviews, and recalls. Snippets can mis-match a SKU — read the linked sources.</div>`
        : `<div class="alert"><strong>Little or no usable research.</strong> Below is what we could fetch without inventing reviews or source URLs.</div>`;

    app.innerHTML = `
      ${header("check")}
      <main class="wrap">
        <div class="page-head">
          <p class="eyebrow"><a href="/check" data-link style="color:inherit;text-decoration:none">← Checker</a></p>
          <h1>Result</h1>
        </div>
        <div class="result-layout">
          <section class="result-main">
            ${result.isExample ? `<div class="example-flag">Example — not live research</div>` : ""}
            ${fetchAlert}
            ${researchNote}
            <div class="product-row">
              ${thumb}
              <div>
                <h2>${escapeHtml(result.title || "Untitled product")}</h2>
                <div class="price">${result.price ? escapeHtml(result.price) : "Price not found in metadata"}</div>
                ${
                  result.url
                    ? `<div class="h-meta" style="margin-top:0.35rem;word-break:break-all"><a href="${escapeAttr(
                        result.url
                      )}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.url)}</a></div>`
                    : ""
                }
              </div>
            </div>
            <div class="verdict-block">
              <div class="verdict-huge ${v}">${escapeHtml(label)}</div>
              <p class="verdict-reason">${escapeHtml(reason)}</p>
              <p class="verdict-underhood">Under the hood: <strong>${escapeHtml(result.verdict || "Wait")}</strong></p>
            </div>
            ${honestyStrip(result)}
            <p class="summary">${escapeHtml(result.summary || "")}</p>
            <h3 style="font-family:var(--serif);font-weight:400;font-size:1.25rem;margin:0 0 0.5rem">Gotchas</h3>
            <ul class="gotchas">
              ${(result.gotchas || [])
                .map(
                  (g) => `
                <li>
                  <h3>${escapeHtml(g.title)}</h3>
                  <p>${escapeHtml(g.detail)}</p>
                  ${
                    Array.isArray(g.sourceUrls) && g.sourceUrls.length
                      ? `<p class="h-meta" style="margin-top:0.35rem">${g.sourceUrls
                          .slice(0, 3)
                          .map(
                            (u) =>
                              `<a href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                                u.length > 60 ? u.slice(0, 57) + "…" : u
                              )}</a>`
                          )
                          .join(" · ")}</p>`
                      : ""
                  }
                </li>`
                )
                .join("")}
            </ul>
            ${
              result.disclaimer
                ? `<p class="disclaimer">${escapeHtml(result.disclaimer)}</p>`
                : ""
            }
          </section>
          <aside class="result-side sources">
            <div class="side-block">
              <h3>Sources</h3>
              ${
                (result.sources || []).length
                  ? `<ul>${result.sources
                      .map(
                        (s) => `
                    <li>
                      <a href="${escapeAttr(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                        s.label
                      )}</a>
                      ${s.note ? `<span class="note">${escapeHtml(s.note)}</span>` : ""}
                    </li>`
                      )
                      .join("")}</ul>`
                  : `<p class="empty">No third-party sources. Only the URL you provided${
                      result.fetched?.title ? " and page metadata we fetched" : ""
                    }.</p>`
              }
            </div>
            <div class="side-block" style="margin-top:1.4rem">
              <h3>Fetched facts</h3>
              <ul class="gotchas">
                <li><h3>Title</h3><p>${escapeHtml(result.fetched?.title || "—")}</p></li>
                <li><h3>Price</h3><p>${escapeHtml(result.fetched?.price || "—")}</p></li>
                <li><h3>Image</h3><p>${result.fetched?.image ? "Yes" : "No"}</p></li>
              </ul>
            </div>
            <div style="margin-top:1.25rem;display:flex;gap:0.55rem;flex-wrap:wrap">
              <a class="btn btn-accent" href="/check" data-link>Check another</a>
              <button class="btn btn-ghost" type="button" id="copy-link">Copy result summary</button>
            </div>
          </aside>
        </div>
      </main>
      ${footer()}
    `;

    document.getElementById("copy-link")?.addEventListener("click", async () => {
      const text = `${verdictLabel(result)} (${result.verdict}): ${result.title}${result.price ? " (" + result.price + ")" : ""}\n${
        verdictReason(result)
      }\n${result.summary || ""}\n${(result.gotchas || []).map((g) => "• " + g.title).join("\n")}`;
      try {
        await navigator.clipboard.writeText(text);
        const btn = document.getElementById("copy-link");
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy result summary"), 1200);
      } catch {
        /* ignore */
      }
    });
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }

  function formatWhen(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  route();
})();
