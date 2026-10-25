(function () {
  "use strict";
  const L = window.RefLib;
  const $ = id => document.getElementById(id);
  const PAGE = 40;

  let tools = [], authors = {}, search = null;
  const aliasMap = new Map(), doiMap = new Map(), pmidMap = new Map(), idIndex = new Map();
  let basket = [];            // tool ids, in the order added
  let versions = {}, choices = {};   // tool id -> version typed by the user / chosen paper (doi, or "pmid:N")
  let filters = { doi: false, nopre: false, repo: false, ok: false, lic: "" };
  let alts = null, altsLoading = false, openPicker = null, metaVersion = "";
  let shown = [], shownCount = 0, fmt = "bib";

  /* ------------------------------------------------------------ helpers */

  // Build DOM without innerHTML: titles in the data may contain markup characters.
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  const safeUrl = u => (/^https?:\/\//i.test(u || "") ? u : null);
  const ext = (href, text, title) => href && h("a", { href, target: "_blank", rel: "noopener noreferrer", title }, text);
  const doiUrl = d => "https://doi.org/" + encodeURI(d);

  function firstAuthor(tool, byTool) {
    const list = L.splitAuthors((byTool || authors)[tool.i]);
    if (!list.length) return "";
    const p = L.parseAuthor(list[0]);
    const name = p.literal || p.family;
    return list.length > 2 ? name + " et al." : list.length === 2 ? name + " & " + (L.parseAuthor(list[1]).family || "") : name;
  }
  const shortCite = (t, byTool) => [firstAuthor(t, byTool), t.y && `(${t.y})`, t.j].filter(Boolean).join(" ");

  /* -------------------------------------------------------------- flags */

  function badgesFor(t) {
    const f = t.f || [], out = [];
    const b = (text, cls, tip) => out.push(h("span", { class: "badge " + (cls || ""), title: tip }, text));
    if (f.includes("nopub") || f.includes("nocite"))
      b("no citation", "bad", "No paper is listed for this tool. Cite the software by its URL and version instead of inventing a reference.");
    if (f.includes("amb") && !f.includes("chosen"))
      b("check: " + (t.np || "several") + " papers", "warn", "bio.tools lists several papers and does not single one out. The most-cited is shown; confirm it is the one you want.");
    else if (t.np > 1)
      b("primary of " + t.np, "", "bio.tools lists " + t.np + " papers for this tool; this is the one it marks as primary.");
    if (f.includes("pre"))
      b("preprint", "warn", "The DOI belongs to a preprint server. A published version may exist; check before citing.");
    if (f.includes("verify"))
      b("check: manual entry", "warn", "Entered by hand and not yet confirmed against PubMed/Crossref.");
    else if (t.s === "override")
      b("manual entry", "ok", "Entered by hand (overrides.json).");
    if (f.includes("chosen"))
      b("your choice", "ok", "You picked this paper from the others bio.tools lists for this tool.");
    if (f.includes("cor"))
      b("corrected", "ok", t.note || "A wrong ID from bio.tools was repaired using PubMed.");
    return out;
  }
  const needsCheck = t => (t.f || []).some(x => ["amb", "pre", "verify", "nopub", "nocite"].includes(x));
  function reasons(t) {
    const f = t.f || [], r = [];
    if (f.includes("amb")) r.push("several papers listed");
    if (f.includes("pre")) r.push("preprint DOI");
    if (f.includes("verify")) r.push("unverified manual entry");
    if (f.includes("nopub") || f.includes("nocite")) r.push("no citation");
    return r.join(", ");
  }

  /* -------------------------------------------------------------- cards */

  function addButton(t) {
    const inB = basket.includes(t.i);
    const btn = h("button", {
      class: "btn" + (inB ? " added" : ""), "aria-pressed": inB ? "true" : "false",
      onclick: () => { toggle(t.i); renderResults(true); },
    }, inB ? "Added ✓" : "Add");
    return btn;
  }

  function card(t) {
    const hasCite = t.d || t.p || t.u;
    const links = [
      t.d && ext(doiUrl(t.d), "DOI " + t.d),
      t.p && ext("https://pubmed.ncbi.nlm.nih.gov/" + encodeURIComponent(t.p) + "/", "PMID " + t.p),
      t.c && ext("https://pmc.ncbi.nlm.nih.gov/articles/" + encodeURIComponent(t.c) + "/", t.c),
      t.u && ext(safeUrl(t.u), "Project page"),
      t.r && ext(safeUrl(t.r), "Repository"),
      t.h && t.h !== t.r && ext(safeUrl(t.h), "Homepage"),
      ext("https://bio.tools/" + encodeURIComponent(t.i.startsWith("override:") ? t.i.slice(9) : t.i), "bio.tools"),
      t.l && h("span", {}, t.l),
    ].filter(Boolean);
    return h("li", { class: "card" },
      h("h3", {}, t.n, (t.a && t.a.length) ? h("span", { class: "al" }, "also: " + t.a.slice(0, 3).join(", ")) : null),
      h("div", { class: "act" }, hasCite ? addButton(t) : h("span", { class: "badge bad" }, "no citation")),
      t.t ? h("p", { class: "ttl" }, t.t) : (t.ds ? h("p", { class: "desc" }, t.ds) : null),
      hasCite ? h("p", { class: "cit" }, shortCite(t)) : null,
      h("div", { class: "links" }, links),
      h("div", { class: "badges" }, badgesFor(t)));
  }

  function renderResults(keepScroll) {
    const list = $("results");
    const y = window.scrollY;
    list.replaceChildren(...shown.slice(0, shownCount).map(i => card(tools[i])));
    $("more").hidden = shownCount >= shown.length;
    if (keepScroll) window.scrollTo(0, y);
  }

  /* -------------------------------------------------------------- search */

  const passes = t => {
    const f = t.f || [];
    return !(filters.doi && !(t.d || t.p || t.u)) && !(filters.nopre && f.includes("pre")) && !(filters.repo && !t.r) &&
      !(filters.ok && needsCheck(t)) && !(filters.lic && t.l !== filters.lic);
  };
  function setupFilters() {
    const counts = new Map();
    for (const t of tools) if (t.l) counts.set(t.l, (counts.get(t.l) || 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 14);
    $("f-lic").append(...top.map(([l, n]) => h("option", { value: l }, `${l} (${n.toLocaleString()})`)));
    const again = () => { filters = { doi: $("f-doi").checked, nopre: $("f-nopre").checked, repo: $("f-repo").checked,
      ok: $("f-ok").checked, lic: $("f-lic").value }; runSearch($("q").value); };
    $("filters").addEventListener("change", again);
    $("f-repo").closest("label").hidden = $("f-lic").closest("label").hidden = !top.length;   // built without the records dump
  }

  function runSearch(q) {
    q = q.trim();
    $("chips").hidden = !!q;
    if (!q) { shown = []; $("status").textContent = ""; renderResults(); return; }
    let ids = [], kind = "";
    const doi = /10\.\d{4,9}\/[^\s"<>]+/.exec(q);
    const pm = /^(?:pmid:?\s*)?(\d{4,9})$/i.exec(q);
    if (doi && doiMap.has(doi[0].toLowerCase().replace(/[.,;]+$/, ""))) {
      ids = doiMap.get(doi[0].toLowerCase().replace(/[.,;]+$/, "")); kind = "DOI";
    } else if (pm && pmidMap.has(pm[1])) {
      ids = pmidMap.get(pm[1]); kind = "PMID";
    } else {
      const exact = aliasMap.get(L.normalizeAlias(q)) || [];
      let hits = search.search(q, { combineWith: "AND" });
      if (!hits.length && q.includes(" ")) hits = search.search(q, { combineWith: "OR" });
      ids = [...new Set([...exact, ...hits.map(x => x.id)])];
    }
    const total = ids.length;
    ids = ids.filter(i => passes(tools[i]));
    shown = ids; shownCount = PAGE;
    const hidden = total - ids.length;
    $("status").textContent = ids.length
      ? `${ids.length.toLocaleString()} ${kind ? "tool" + (ids.length > 1 ? "s" : "") + " for this " + kind : "result" + (ids.length > 1 ? "s" : "")}` +
        (hidden ? ` (${hidden.toLocaleString()} hidden by the filters)` : "")
      : total ? `${total.toLocaleString()} found, all hidden by the filters.`
      : "No tool found. If it is not in bio.tools, cite the software by its URL and version rather than guessing a paper.";
    renderResults();
  }

  /* ------------------------------------------------------------- basket */

  const byId = id => tools[idIndex.get(id)];
  const paperKey = p => (p.d ? p.d.toLowerCase() : p.p ? "pmid:" + p.p : "");
  const altsFor = id => (alts && alts[id]) || [];

  // The tool as it will be cited: the default paper, or the one the user picked from the alternatives.
  function effective(t) {
    const c = choices[t.i], a = c && altsFor(t.i).find(x => paperKey(x) === c);
    if (!a) return { tool: t, authors: authors[t.i] };
    const f = (t.f || []).filter(x => x !== "amb" && x !== "pre" && x !== "cor");
    if (a.pre) f.push("pre");
    f.push("chosen");
    return { tool: { ...t, d: a.d, p: a.p, c: undefined, t: a.t, j: a.j, y: a.y, k: undefined, f, note: undefined },
             authors: a.au };
  }
  const basketTools = () => basket.map(byId).filter(Boolean).map(t => effective(t).tool);
  const authorsNow = () => {
    const m = { ...authors };
    for (const t of basket.map(byId).filter(Boolean)) m[t.i] = effective(t).authors;
    return m;
  };

  function toggle(id) {
    basket = basket.includes(id) ? basket.filter(x => x !== id) : [...basket, id];
    if (!basket.includes(id)) { delete versions[id]; delete choices[id]; if (openPicker === id) openPicker = null; }
    saveBasket(); renderBasket();
  }

  // Link format: #t=id,id&v=id:version,...&c=id:doi,...  (every part percent-encoded; older #t=... links still work)
  const packPairs = o => Object.entries(o).filter(([, v]) => v).map(([k, v]) => encodeURIComponent(k) + ":" + encodeURIComponent(v)).join(",");
  const unpackPairs = str => {
    const o = {};
    for (const pair of (str || "").split(",")) {
      const [k, v] = pair.split(":").map(x => { try { return decodeURIComponent(x); } catch (e) { return ""; } });
      if (k && v) o[k] = v;
    }
    return o;
  };

  function saveBasket() {
    const parts = [];
    if (basket.length) {
      parts.push("t=" + basket.map(encodeURIComponent).join(","));
      if (Object.keys(versions).length) parts.push("v=" + packPairs(versions));
      if (Object.keys(choices).length) parts.push("c=" + packPairs(choices));
    }
    const hash = parts.length ? "#" + parts.join("&") : "";
    try { history.replaceState(null, "", location.pathname + location.search + hash); } catch (e) { /* ignore */ }
    try { localStorage.setItem("tool-refs-basket", JSON.stringify({ basket, versions, choices })); } catch (e) { /* private mode */ }
  }

  function loadBasket() {
    let ids = null, v = {}, c = {};
    const m = /^#t=([^&]*)(?:&(.*))?$/.exec(location.hash);
    if (m) {
      ids = m[1].split(",").map(x => { try { return decodeURIComponent(x); } catch (e) { return ""; } }).filter(Boolean);
      const params = new URLSearchParams(m[2] || "");
      v = unpackPairs(params.get("v")); c = unpackPairs(params.get("c"));
    } else {
      try {
        const saved = JSON.parse(localStorage.getItem("tool-refs-basket") || "null");
        if (Array.isArray(saved)) ids = saved;           // saved by an earlier version of the page
        else if (saved) { ids = saved.basket; v = saved.versions || {}; c = saved.choices || {}; }
      } catch (e) { /* ignore */ }
    }
    basket = [...new Set((Array.isArray(ids) ? ids : []).filter(id => idIndex.has(id)))];
    versions = {}; choices = {};
    for (const id of basket) { if (typeof v[id] === "string") versions[id] = v[id].slice(0, 40); if (typeof c[id] === "string") choices[id] = c[id]; }
    if (Object.keys(choices).length) loadAlts();
  }

  async function loadAlts() {
    if (alts || altsLoading) return;
    altsLoading = true;
    try {
      const r = await fetch("data/alts.json?v=" + metaVersion);
      if (!r.ok) throw new Error("HTTP " + r.status);
      alts = await r.json();
    } catch (e) { alts = {}; $("note").textContent = "Could not load the alternative papers (" + e.message + ")."; }
    altsLoading = false;
    renderBasket();
  }

  function pickerOption(id, key, p, isDefault) {
    const name = "paper-" + id;
    const meta = [p.j, p.y, p.cc ? p.cc.toLocaleString() + " citations" : "", p.pre ? "preprint" : ""].filter(Boolean).join(" · ");
    return h("label", { class: "opt" },
      h("input", { type: "radio", name, checked: (choices[id] || "") === key,
        onchange: () => { if (key) choices[id] = key; else delete choices[id]; saveBasket(); renderBasket(); } }),
      h("span", {}, h("span", { class: "ptitle" }, p.t || "(no title)"),
        h("span", { class: "pmeta" }, [meta, isDefault ? "shown by default" : ""].filter(Boolean).join(" · ")),
        p.d ? h("span", { class: "pmeta" }, "DOI " + p.d) : null));
  }

  function picker(t) {
    if (!alts) { loadAlts(); return h("p", { class: "hint" }, "Loading the other papers…"); }
    const list = altsFor(t.i);
    if (!list.length) return h("p", { class: "hint" }, "No other papers with a title are listed for this tool.");
    return h("fieldset", { class: "picker" },
      h("legend", {}, "Which paper should be cited?"),
      pickerOption(t.i, "", t, true), list.map(a => pickerOption(t.i, paperKey(a), a, false)));
  }

  function basketItem(orig, t, am) {
    const id = orig.i;
    const alt = orig.na ? h("button", { class: "link", "aria-expanded": String(openPicker === id),
      onclick: () => { openPicker = openPicker === id ? null : id; renderBasket(); } },
      openPicker === id ? "Hide papers" : `Choose paper (${orig.na} other${orig.na > 1 ? "s" : ""})`) : null;
    const ver = h("input", { type: "text", class: "ver", value: versions[id] || "", placeholder: "version, e.g. 1.2.3", maxlength: 40,
      "aria-label": "Version of " + t.n, autocomplete: "off", spellcheck: "false",
      oninput: e => { const v = e.target.value.trim(); if (v) versions[id] = v; else delete versions[id]; saveBasket(); renderOutput(); } });
    return h("li", {},
      h("span", { class: "nm" }, t.n),
      h("button", { "aria-label": "Remove " + t.n, title: "Remove", onclick: () => { toggle(id); renderResults(true); } }, "×"),
      h("span", { class: "sub" }, [shortCite(t, am) || "software citation", reasons(t) && "⚠ " + reasons(t)].filter(Boolean).join(" · ")),
      h("div", { class: "tune" }, ver, alt),
      openPicker === id ? h("div", { class: "pick" }, picker(orig)) : null);
  }

  function renderBasket() {
    const origs = basket.map(byId).filter(Boolean), am = authorsNow();
    const ts = basketTools();
    $("count").textContent = ts.length;
    $("empty").hidden = ts.length > 0;
    $("clear").hidden = $("export").hidden = ts.length === 0;
    $("items").replaceChildren(...origs.map((o, i) => basketItem(o, ts[i], am)));
    const flagged = ts.filter(needsCheck);
    $("warn").hidden = !flagged.length;
    $("warn").textContent = "";
    if (flagged.length) $("warn").textContent = `${flagged.length} of ${ts.length} need a manual check before you submit: ${flagged.map(t => t.n).join(", ")}.`;
    renderOutput();
  }

  /* ------------------------------------------------------------- output */

  const EXT = { bib: ["references.bib", "application/x-bibtex"], ris: ["references.ris", "application/x-research-info-systems"],
    csl: ["references.json", "application/json"], txt: ["references.txt", "text/plain"] };

  function renderOutput() {
    const ts = basketTools();
    if (!ts.length) return;
    const am = authorsNow(), withVer = ts.filter(t => versions[t.i]);
    $("softwareWrap").hidden = !withVer.length;
    const entries = L.buildEntries(ts, am, { versions, software: withVer.length > 0 && $("software").checked });
    $("methods").hidden = !withVer.length;
    if (withVer.length) $("sw").value = L.softwareList(ts, entries, versions, fmt === "bib");
    const picked = Object.keys(choices).filter(id => basket.includes(id) && altsFor(id).some(a => paperKey(a) === choices[id]));
    $("copyOverrides").hidden = !picked.length;
    const opts = { escape: true, protect: $("protect").checked };
    const style = $("style").value;
    $("styleWrap").hidden = fmt !== "txt";
    $("out").value = fmt === "bib" ? L.toBibtexAll(entries, opts) : fmt === "ris" ? L.toRisAll(entries)
      : fmt === "csl" ? L.toCslAll(entries) : style === "plain" ? L.toTextAll(entries) : L.toStyledAll(entries, style);
    $("printOut").textContent = "References\n\n" + $("out").value;
    $("protectWrap").hidden = fmt !== "bib";
    $("cite").hidden = fmt !== "bib";
    $("cite").textContent = "\\cite{" + entries.map(e => e.key).join(",") + "}";
    const shared = entries.filter(e => e.tools.length > 1);
    $("note").textContent = shared.length
      ? "Shared reference: " + shared.map(e => e.tools.join(" + ")).join("; ") + " are cited with one entry." : "";
  }

  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) { const t = $("out"); if (text === t.value) { t.select(); document.execCommand("copy"); } else { prompt("Copy this link:", text); return; } }
    $("note").textContent = okMsg;
  }

  /* -------------------------------------------------------------- paste */

  function runFind() {
    const text = $("paste").value;
    const ids = L.findIdentifiers(text, doiMap, pmidMap);
    let rows = ids.rows;
    if (!L.looksLikeReferenceFile(text)) {                  // a reference file's titles would add false name matches
      const taken = new Set(rows.map(r => r.candidates.join()));
      rows = rows.concat(L.findMentions(text, aliasMap).filter(m => !taken.has(m.candidates.join())));
    }
    renderFound(rows, ids.unmatched.length ? ` ${ids.unmatched.length} DOI/PMID not in the index.` : "");
  }

  function renderFound(mentions, extra) {
    const seen = new Map();
    for (const m of mentions) if (!seen.has(m.alias)) seen.set(m.alias, m);
    const rows = [...seen.values()];
    $("pasteStatus").textContent = rows.length
      ? `${rows.length} possible tool${rows.length > 1 ? "s" : ""} found. Untick anything that is just a common word.${extra || ""}`
      : "No tool names, DOIs or PMIDs from the index were found in this text." + (extra || "");
    $("addFound").hidden = !rows.length;
    $("found").replaceChildren(...rows.map(m => {
      const sel = m.candidates.length > 1
        ? h("select", { "aria-label": "Which tool is “" + m.text + "”?" },
            m.candidates.map(i => h("option", { value: tools[i].i }, `${tools[i].n}${tools[i].y ? " (" + tools[i].y + ")" : ""}${tools[i].t ? " – " + tools[i].t.slice(0, 50) : ""}`)))
        : null;
      const first = tools[m.candidates[0]];
      const usable = m.candidates.some(i => tools[i].d || tools[i].p || tools[i].u);
      const cb = h("input", { type: "checkbox", "aria-label": "Include " + first.n, checked: m.likely && usable, disabled: !usable });
      return h("li", { "data-alias": m.alias, "data-first": first.i, "data-version": m.version || "" },
        cb,
        h("div", {}, h("span", { class: "nm" }, sel ? "" : first.n), sel),
        h("span", { class: "sub" }, (m.byId ? `matched by ${m.text}` : `matched “${m.text}” · ${m.likely ? "looks like a tool name" : "could be an ordinary word, please confirm"}`) +
          (m.version ? ` · version ${m.version}` : "") + (m.candidates.length > 1 ? ` · ${m.candidates.length} tools share this name` : "") + (usable ? "" : " · no citation available")));
    }));
  }

  function addFound() {
    let added = 0;
    for (const li of $("found").children) {
      if (!li.querySelector("input[type=checkbox]").checked) continue;
      const sel = li.querySelector("select");
      const id = sel ? sel.value : li.dataset.first;
      if (!basket.includes(id)) { basket.push(id); added++; }
      if (li.dataset.version && !versions[id]) versions[id] = li.dataset.version;
    }
    saveBasket(); renderBasket(); renderResults(true);
    $("pasteStatus").textContent = `Added ${added} to the bibliography.`;
  }

  /* --------------------------------------------------------------- boot */

  function index() {
    tools.forEach((t, i) => {
      idIndex.set(t.i, i);
      for (const a of new Set([L.normalizeAlias(t.n), L.normalizeAlias(t.i), ...(t.a || [])])) {
        if (!a) continue;
        if (!aliasMap.has(a)) aliasMap.set(a, []);
        aliasMap.get(a).push(i);
      }
      if (t.d) { const k = t.d.toLowerCase(); (doiMap.get(k) || doiMap.set(k, []).get(k)).push(i); }
      if (t.p) (pmidMap.get(t.p) || pmidMap.set(t.p, []).get(t.p)).push(i);
    });
    search = new MiniSearch({
      fields: ["n", "al", "ids", "t", "j"], idField: "id",
      searchOptions: { boost: { n: 8, al: 5, ids: 4, t: 1, j: 0.3 }, prefix: true,
        fuzzy: term => (term.length > 5 ? 0.15 : false) },
    });
    return search.addAllAsync(tools.map((t, i) => ({ id: i, n: t.n, al: (t.a || []).join(" "), ids: t.i.replace(/^override:/, ""), t: t.t || "", j: t.j || "" })), { chunkSize: 2000 });
  }

  function setupUi(meta) {
    const bits = [`${meta.tools.toLocaleString()} tools`, `${meta.with_doi.toLocaleString()} with a DOI`, `${meta.with_pmid.toLocaleString()} with a PMID`];
    if (meta.has_repo_links) bits.push(`${meta.with_repo.toLocaleString()} with a repository link`);
    $("meta").textContent = bits.join(" · ") + " · built " + meta.built;
    $("q").disabled = false; $("find").disabled = false;
    const examples = ["bwa", "samtools", "spades", "fastp", "prokka", "kraken2", "gatk", "mlst", "abricate", "quast", "fastqc"];
    $("chips").replaceChildren(...examples.filter(a => aliasMap.has(a)).map(a =>
      h("button", { onclick: () => { $("q").value = a; runSearch(a); } }, tools[aliasMap.get(a)[0]].n)));
    setupFilters();
    loadBasket(); renderBasket();
  }

  async function boot() {
    try {
      const meta = await (await fetch("data/meta.json", { cache: "no-cache" })).json();
      metaVersion = meta.version;
      const v = "?v=" + meta.version;
      const [t, a] = await Promise.all([fetch("data/tools.json" + v), fetch("data/authors.json" + v)]);
      if (!t.ok || !a.ok) throw new Error("HTTP " + (t.ok ? a.status : t.status));
      tools = await t.json(); authors = await a.json();
      $("meta").textContent = "Indexing…";
      await index();
      setupUi(meta);
      const q = new URLSearchParams(location.search).get("q");
      if (q) { $("q").value = q; runSearch(q); }
    } catch (e) {
      $("meta").textContent = "Could not load the tool index (" + e.message + "). If you opened this file directly, serve the folder over HTTP instead (python3 -m http.server).";
    }
  }

  /* -------------------------------------------------------------- events */

  let timer;
  $("q").addEventListener("input", e => { clearTimeout(timer); timer = setTimeout(() => runSearch(e.target.value), 120); });
  $("more").addEventListener("click", () => { shownCount += PAGE; renderResults(true); });
  $("clear").addEventListener("click", () => { basket = []; saveBasket(); renderBasket(); renderResults(true); });
  $("protect").addEventListener("change", renderOutput);
  $("find").addEventListener("click", runFind);
  $("file").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2e6) { $("fileName").textContent = "That file is over 2 MB; open a smaller one."; return; }
    $("paste").value = await f.text();
    $("fileName").textContent = f.name;
    runFind();
    e.target.value = "";
  });
  $("style").addEventListener("change", renderOutput);
  $("print").addEventListener("click", () => window.print());

  /* theme: automatic (follow the system), light or dark */
  const THEMES = ["auto", "light", "dark"];
  function applyTheme(t) {
    if (t === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    $("theme").textContent = "Theme: " + t;
    try { if (t === "auto") localStorage.removeItem("tool-refs-theme"); else localStorage.setItem("tool-refs-theme", t); } catch (e) { /* private mode */ }
  }
  let theme = document.documentElement.dataset.theme || "auto";
  applyTheme(theme);
  $("theme").addEventListener("click", () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; applyTheme(theme); });

  /* how to cite this site */
  const SITE_URL = "https://motroy.github.io/reference-helper/";
  $("siteCite").value = `Motro Y. Tool References [Internet]. ${SITE_URL}. Data: bio.tools (CC BY 4.0). Accessed ${new Date().toISOString().slice(0, 10)}.\n\n` +
    `@misc{toolreferences,\n  author = {Motro, Yair},\n  title = {Tool References},\n  year = {${new Date().getFullYear()}},\n  url = {${SITE_URL}},\n  note = {Accessed ${new Date().toISOString().slice(0, 10)}}\n}\n`;
  $("copySite").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("siteCite").value); $("copySite").textContent = "Copied"; } catch (e) { $("siteCite").select(); document.execCommand("copy"); } });
  $("addFound").addEventListener("click", addFound);
  $("copy").addEventListener("click", () => copyText($("out").value, "Copied."));
  $("copySw").addEventListener("click", () => copyText($("sw").value, "Copied the software list."));
  $("software").addEventListener("change", renderOutput);
  $("copyOverrides").addEventListener("click", () => {
    const o = {};
    for (const t of basket.map(byId).filter(Boolean)) {
      const e = effective(t);
      if (!e.tool.f.includes("chosen")) continue;
      o[L.normalizeAlias(t.n)] = { display_name: t.n, doi: e.tool.d, pmid: e.tool.p, title: e.tool.t, journal: e.tool.j, year: e.tool.y,
        authors: e.authors, bibtex_key: L.normalizeAlias(t.n) + (e.tool.y || "nd") };
      for (const k of Object.keys(o[L.normalizeAlias(t.n)])) if (o[L.normalizeAlias(t.n)][k] == null) delete o[L.normalizeAlias(t.n)][k];
    }
    copyText(JSON.stringify(o, null, 2) + "\n", "Copied. Paste these entries into data/overrides.json and rebuild to make the choice the default for everyone.");
  });
  $("share").addEventListener("click", () => copyText(location.href, "Link copied. Anyone opening it gets this list."));
  $("download").addEventListener("click", () => {
    const [name, type] = EXT[fmt];
    const a = h("a", { href: URL.createObjectURL(new Blob([$("out").value], { type: type + ";charset=utf-8" })), download: name });
    document.body.append(a); a.click(); a.remove();
  });
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    fmt = b.dataset.fmt;
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-checked", String(x === b)));
    renderOutput();
  }));
  const tabs = { search: ["tab-search", "pane-search"], paste: ["tab-paste", "pane-paste"] };
  Object.entries(tabs).forEach(([k, [tab]]) => $(tab).addEventListener("click", () => {
    for (const [k2, [t2, p2]] of Object.entries(tabs)) {
      $(t2).setAttribute("aria-selected", String(k2 === k)); $(t2).tabIndex = k2 === k ? 0 : -1; $(p2).hidden = k2 !== k;
    }
  }));
  window.addEventListener("hashchange", () => { if (tools.length) { loadBasket(); renderBasket(); renderResults(true); } });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); $("q").focus(); }
  });

  boot();
})();
