# Tool References

A searchable, static website for finding the paper to cite for a bioinformatics tool and exporting a
bibliography for a methods section. It runs entirely in your browser: no server, no account, and
nothing you type or paste is sent anywhere.

**Live site:** `https://motroy.github.io/reference-helper/`

## What it does

- **Search** about 27,000 tools by name, alias, bio.tools ID, paper title, DOI or PMID.
- **Build a bibliography:** add tools to a list and export it as **BibTeX**, **RIS**, **CSL JSON** or
  plain text. For BibTeX the page also gives a ready-made `\cite{...}` line.
- **Paste methods text:** paste a paragraph and the page lists the tool names it recognises, for you to
  confirm and add. Short lowercase words that could be ordinary English (for example "tee" or "moss")
  are left unticked.
- **Share a list:** the bibliography is stored in the page link (`#t=bwa,samtools,...`) and in your
  browser, so a link reproduces the same list.
- **Links:** each entry links to its DOI, PubMed and PMC records and to bio.tools.

## Reading the badges

Every citation is a database record, never generated text, but some records need a human check:

| Badge | Meaning |
|---|---|
| **check: N papers** | bio.tools lists several papers and does not single one out. The most-cited is shown. Confirm it is the one you want. |
| **primary of N** | bio.tools lists several papers and marks this one as primary. |
| **preprint** | The DOI belongs to a preprint server. A published version may exist. |
| **check: manual entry** | Entered by hand and not yet confirmed against PubMed or Crossref. |
| **manual entry** | Entered by hand (for example software cited by its project page). |
| **corrected** | A wrong PMID or malformed DOI from bio.tools was repaired using PubMed. Hover for the original value. |
| **no citation** | No paper is known for the tool. Cite the software by its URL and version rather than guessing a paper. |

The bibliography panel warns when any selected entry needs checking. **Always confirm flagged entries
against the paper before submitting.**

## Using the exports

- **BibTeX** is identical to the `dochist-writer lookup --bib` output when the two options below are
  off. By default the page escapes `& % # _` in titles and journal names and wraps titles in braces so
  tool names keep their capitalisation (BWA stays BWA). You can turn the braces off with the checkbox.
- Tools that share one paper are exported as a single entry, and duplicate cite keys get a suffix
  (`a`, `b`, ...).
- Software with no journal paper (for example FastQC) is exported as `@misc` with its URL.

## Where the data comes from

- Tool and publication records come from the [bio.tools](https://bio.tools) registry (Zenodo
  snapshot).
- Missing authors, titles, journals and years were filled from [PubMed](https://pubmed.ncbi.nlm.nih.gov)
  and [Crossref](https://www.crossref.org).
- Each entry's DOI was cross-checked against the DOI PubMed holds for its PMID. About 70 wrong or
  malformed IDs were corrected automatically; other disagreements (preprint versus published paper,
  F1000Research versions) were left for you to judge and are flagged where relevant.
- A small set of hand-written overrides replaces the registry's pick where it is wrong or missing.

The data is a snapshot. The build date is shown at the top of the page. Registry records can be wrong
or out of date, so treat the site as a fast way to find the right reference, not as proof that it is
correct.

## Known limitations

- One paper is shown per tool (the one bio.tools marks as primary, otherwise the most cited). Tools
  often have a second paper worth citing, such as a later version or a companion method. Check the tool's
  documentation, and use the *check* and *primary of N* badges as a prompt to do so.
- A few hundred tools were lost when the alias table was built and do not appear.
- Repository (GitHub) links are only shown if the site was built with the bio.tools records dump; check
  the line under the page title for "with a repository link".
- Tools with no listed paper show *no citation*.

## Contents of this repository

This repository contains only the built site, served from the `/docs` folder:

| Path | What |
|---|---|
| `docs/index.html`, `app.js`, `style.css` | the page |
| `docs/lib.js` | citation formatting and tool-name matching |
| `docs/vendor/` | [MiniSearch](https://github.com/lucaong/minisearch) (MIT licence), the in-browser search library |
| `docs/data/tools.json` | one record per tool (search and citation fields) |
| `docs/data/authors.json` | author lists, used when formatting references |
| `docs/data/meta.json` | build date, counts and a content hash used to refresh the browser cache |

The site is regenerated from a local SQLite lookup database with a build script; it is not built by
GitHub Actions. To update it, rebuild locally and commit the new `docs/` folder.

## Run locally

```
cd docs
python3 -m http.server 8000
```
Then open <http://localhost:8000>. Opening `index.html` directly from disk will not work, because
browsers block the page from loading its data files.

## Licence and attribution

Add your licence here. bio.tools data is available under CC BY 4.0 (check the registry's current
terms before redistributing), and MiniSearch is MIT licensed (see `docs/vendor/`).
