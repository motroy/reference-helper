/* Pure functions shared by the page and the Node tests (no DOM). The BibTeX output is a port of
   dochist_writer.citations.to_bibtex/bibtex_name, so site and CLI produce the same entries. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RefLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------------------------------------------------------- names */

  // Same key as the Python side: accents stripped, lower-case, letters and digits only.
  function normalizeAlias(s) {
    if (!s) return "";
    return String(s).normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "");
  }

  const SCRIPT_EXT = [".py", ".pl", ".sh", ".rb", ".r", ".jar"];
  function stripScriptExt(name) {
    const lower = name.toLowerCase();
    for (const ext of SCRIPT_EXT) if (lower.endsWith(ext)) return name.slice(0, -ext.length);
    return name;
  }

  const SURNAME_INITIALS = /^(.+?)\s+((?:[A-Z]\.?-?)+)$/;

  // "Li H." -> "Li, H."  (BibTeX would otherwise read first name "Li", surname "H.")
  function bibtexName(name) {
    name = name.trim();
    if (/\sand\s/.test(name)) return "{" + name + "}";
    if (name.includes(",")) return name;
    const m = SURNAME_INITIALS.exec(name);
    return m ? m[1] + ", " + m[2] : name;
  }

  function splitAuthors(s) {
    return (s || "").split(";").map(a => a.trim()).filter(Boolean);
  }

  /* -------------------------------------------------------------- entries */

  // Software cited by URL rather than by a paper (FastQC) has no journal.
  function entryFromTool(tool, authors) {
    return {
      key: tool.k || normalizeAlias(tool.n) + (tool.y || "nd"),
      authors: splitAuthors(authors),
      title: tool.t || null, journal: tool.j || null, year: tool.y || null,
      doi: tool.d || null, pmid: tool.p || null, url: tool.u || null,
      tools: [tool.n],
    };
  }

  // One entry per distinct paper (two tools citing the same DOI share one entry, so the .bib
  // has no duplicates) and unique keys (a clash gets a, b, c...).
  function buildEntries(tools, authorsById) {
    const entries = [], byPaper = new Map(), keys = new Set();
    for (const tool of tools) {
      const e = entryFromTool(tool, authorsById[tool.i]);
      const id = e.doi ? "doi:" + e.doi.toLowerCase() : e.pmid ? "pmid:" + e.pmid
        : e.url ? "url:" + e.url : "key:" + e.key;
      const seen = byPaper.get(id);
      if (seen) { seen.tools.push(tool.n); continue; }
      let key = e.key, n = 0;
      while (keys.has(key)) key = e.key + String.fromCharCode(97 + n++ % 26) + (n > 26 ? n : "");
      e.key = key;
      keys.add(key);
      byPaper.set(id, e);
      entries.push(e);
    }
    return entries;
  }

  /* --------------------------------------------------------------- BibTeX */

  const latexEscape = s => s.replace(/([&%#_])/g, "\\$1");
  const balanced = s => { let d = 0; for (const c of s) { if (c === "{") d++; if (c === "}" && --d < 0) return false; } return d === 0; };

  /* opts.escape (default true): backslash-escape & % # _ in title/journal.
     opts.protect (default false): wrap the title in {braces} so styles keep tool names capitalised.
     With both off the output is identical to the Python CLI's. */
  function toBibtex(e, opts) {
    opts = Object.assign({ escape: true, protect: false }, opts);
    const fix = s => (opts.escape ? latexEscape(s) : s);
    const fields = [];
    if (e.authors.length) fields.push(`  author = {${e.authors.map(bibtexName).join(" and ")}}`);
    if (e.title) {
      let t = fix(e.title);
      if (opts.protect && balanced(t)) t = "{" + t + "}";
      fields.push(`  title = {${t}}`);
    }
    if (e.journal) fields.push(`  journal = {${fix(e.journal)}}`);
    if (e.year) fields.push(`  year = {${e.year}}`);
    if (e.doi) fields.push(`  doi = {${e.doi}}`);
    if (e.url) fields.push(`  url = {${e.url}}`);
    if (e.pmid) fields.push(`  note = {PMID: ${e.pmid}}`);
    const kind = e.url && !e.journal ? "misc" : "article";
    return `@${kind}{${e.key},\n${fields.join(",\n")}\n}`;
  }

  const toBibtexAll = (entries, opts) => entries.map(e => toBibtex(e, opts)).join("\n\n") + (entries.length ? "\n" : "");

  /* ------------------------------------------------------------------ RIS */

  function parseAuthor(name) {
    name = name.trim();
    if (name.includes(",")) { const [family, ...rest] = name.split(","); return { family: family.trim(), given: rest.join(",").trim() }; }
    const m = SURNAME_INITIALS.exec(name);
    return m ? { family: m[1], given: m[2] } : { literal: name };
  }

  function toRis(e) {
    const software = e.url && !e.journal;
    const lines = [`TY  - ${software ? "COMP" : "JOUR"}`, `ID  - ${e.key}`];
    for (const a of e.authors) {
      const p = parseAuthor(a);
      lines.push(`AU  - ${p.literal || (p.given ? p.family + ", " + p.given : p.family)}`);
    }
    if (e.title) lines.push(`TI  - ${e.title}`);
    if (e.journal) lines.push(`JO  - ${e.journal}`);
    if (e.year) lines.push(`PY  - ${e.year}`);
    if (e.doi) lines.push(`DO  - ${e.doi}`);
    if (e.url) lines.push(`UR  - ${e.url}`);
    if (e.pmid) lines.push(`N1  - PMID: ${e.pmid}`);
    lines.push("ER  - ");
    return lines.join("\r\n");
  }
  const toRisAll = entries => entries.map(toRis).join("\r\n\r\n") + (entries.length ? "\r\n" : "");

  /* ------------------------------------------------------------- CSL JSON */

  function toCsl(e) {
    const o = { id: e.key, type: e.url && !e.journal ? "software" : "article-journal" };
    if (e.authors.length) o.author = e.authors.map(parseAuthor);
    if (e.title) o.title = e.title;
    if (e.journal) o["container-title"] = e.journal;
    if (e.year) o.issued = { "date-parts": [[Number(e.year)]] };
    if (e.doi) o.DOI = e.doi;
    if (e.pmid) o.PMID = String(e.pmid);
    if (e.url) o.URL = e.url;
    return o;
  }
  const toCslAll = entries => JSON.stringify(entries.map(toCsl), null, 2) + "\n";

  /* ----------------------------------------------------------- plain text */

  function toText(e, n) {
    const names = e.authors.map(a => { const p = parseAuthor(a); return p.literal || (p.given ? `${p.family} ${p.given.replace(/[.\s]/g, "")}` : p.family); });
    const au = names.length > 6 ? names.slice(0, 6).join(", ") + ", et al" : names.join(", ");
    const bits = [];
    if (au) bits.push(au + ".");
    if (e.title) bits.push(e.title.replace(/[.?!]$/, "") + ".");
    if (e.journal) bits.push(e.journal + ".");
    if (e.year) bits.push(e.year + ".");
    if (e.doi) bits.push("doi:" + e.doi + ".");
    if (e.url) bits.push("Available from: " + e.url);
    if (e.pmid) bits.push("PMID: " + e.pmid + ".");
    return (n ? n + ". " : "") + bits.join(" ");
  }
  const toTextAll = entries => entries.map((e, i) => toText(e, i + 1)).join("\n") + (entries.length ? "\n" : "");

  /* ------------------------------------------------- finding tools in text */

  const VERSION_AFTER = /^(?:[\s(,]*)(?:v(?:ersion)?\.?\s*)?\d+(?:\.\d+)+/i;
  const VERSION_SUFFIX = /[-_ ]?v?\d+(?:\.\d+)*[a-z]?$/i;

  /* Scan free text for tool names. `aliasMap` maps normalised alias -> array of tool indexes.
     Returns [{text, start, alias, candidates:[idx], likely}] - longest match first (up to three
     words), no overlaps. A match is "likely" when it is written the way tool names are
     (inner capital, digit, hyphen, long, several words, or followed by a version number);
     a plain short lower-case word ("tee", "moss") is only "possible" and should be confirmed. */
  function findMentions(text, aliasMap) {
    const toks = [];
    const re = /[A-Za-z0-9](?:[A-Za-z0-9._+\-]*[A-Za-z0-9])?/g;
    let m;
    while ((m = re.exec(text))) toks.push({ s: m[0], start: m.index, end: m.index + m[0].length });
    const found = [];
    const resolve = raw => {
      const tries = [raw, stripScriptExt(raw)];
      const noVer = raw.replace(VERSION_SUFFIX, "");
      if (noVer && noVer !== raw) tries.push(noVer);
      for (const t of tries) {
        const a = normalizeAlias(t);
        if (a.length >= 3 && aliasMap.has(a)) return { alias: a, via: t };
      }
      return null;
    };
    for (let i = 0; i < toks.length;) {
      let hit = null;
      for (let n = Math.min(3, toks.length - i); n >= 1 && !hit; n--) {
        const span = text.slice(toks[i].start, toks[i + n - 1].end);
        if (n > 1 && /[\n.;:]/.test(text.slice(toks[i].start, toks[i + n - 1].end).replace(/\.(?=[A-Za-z0-9])/g, ""))) continue;
        const r = resolve(n === 1 ? toks[i].s : span.replace(/\s+/g, ""));
        if (r) hit = { n, span, r };
      }
      if (!hit) { i++; continue; }
      const after = text.slice(toks[i + hit.n - 1].end, toks[i + hit.n - 1].end + 14);
      const w = hit.span;
      const prev = text.slice(0, toks[i].start).trimEnd().slice(-1);   // a capital mid-sentence marks a name
      const midCap = /^[A-Z]/.test(w) && prev !== "" && !/[.!?]/.test(prev);
      const likely = midCap || hit.n > 1 || /\d/.test(w) || /[-_.]/.test(w) || /[A-Z].*[A-Z]|[a-z][A-Z]/.test(w) ||
        normalizeAlias(w).length >= 7 || VERSION_AFTER.test(after);
      found.push({ text: w, start: toks[i].start, alias: hit.r.alias, candidates: aliasMap.get(hit.r.alias), likely });
      i += hit.n;
    }
    return found;
  }

  return {
    normalizeAlias, stripScriptExt, bibtexName, parseAuthor, splitAuthors, entryFromTool,
    buildEntries, toBibtex, toBibtexAll, toRis, toRisAll, toCsl, toCslAll, toText, toTextAll,
    findMentions,
  };
});
