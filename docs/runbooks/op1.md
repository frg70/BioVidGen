# Runbook: OP1 Detect paper

## What it does
A content script on the sites in `extension/src/detect/sites.json` finds the paper's DOI, PMID or PMCID and sends it to the side panel. No network calls. Nothing is stored except one log entry per result (duration and DOI source, no URL or text).

Order of sources: `citation_doi`, `dc.identifier`, `prism.doi`, JSON-LD, the URL, then a DOI in the article header. If the header has more than one DOI, the panel asks the student to choose. A DOI found only in page text is also shown as a choice, never as fact.

## Symptoms
| Symptom | Likely cause | What to do |
|---|---|---|
| Panel stays on the empty state on a site | Site is not in `sites.json` (expected, see ADR-0011), or the page has no identifier | Check the list. Adding a site is Type 1: Chrome asks existing users to re-approve |
| "No se encontró un identificador" | Page has a citation title but no DOI, as on some Redalyc articles | Correct behaviour. Manual DOI entry is planned |
| Wrong paper shown | Real bug: stop and investigate. Check the page's `citation_doi` first, then the log's `doiSource` | Add the page as a fixture with a test before fixing |
| `errorCode: META_CONFLICT` in Diagnostics | Page has two different `citation_doi` tags; the first wins | Check that page by hand |
| `errorCode: URL_MISMATCH` | Page's meta DOI differs from the DOI in its URL; meta wins | Usually harmless (redirects). Review if it repeats on one site |
| `errorCode: DETECT_ERROR` | Detector threw on an unusual page; the panel shows the empty state | Save the page's structure as a fixture and reproduce |
| Result list shows 0 articles | The site changed its markup | Update `listIdSelector` in `sites.json` and its fixture. Europe PMC's rule has never been verified live |

## Changing the rules
- Any change to `sites.json`: bump `version`, keep one fixture per entry (OP1-CFG-01).
- Adding or removing a match pattern also changes the manifest: update the SYS-SEC-22 snapshot and cite an ADR.
- Fixtures store metadata only, never article text. `fixtures/pages/labels.json` says which are real captures and which are synthetic.

## Checking against live sites
PR tests never touch the network. To sample real pages, load the unpacked build in Chrome and visit them. Bot checks block some sites under automation (ScienceDirect, medRxiv and Europe PMC on 2026-11-05).
