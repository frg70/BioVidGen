# ADR-0011: How the extension gets access to pages for paper detection (OP1)

Status: Accepted (2026-11-05). The owner chose option A with a condition; the condition failed, so what ships is option B.

## Context
OP1 reads meta tags and a bounded part of the page to find the paper's identifier. A content script cannot run without manifest access. The SVC0 scaffold shipped only `sidePanel` and `storage`, with no host permissions and no `content_scripts` (delta D17), so OP1 has to widen access. Manifest permissions are a Type 1 decision: users see them at install, and later widening can disable the extension until they re-approve.

Drivers:
- **Privacy (rule 1):** read as few pages as possible. Detection itself makes no network calls.
- **Coverage:** students read many journals, including regional ones not on any fixed list.
- **Flow:** the panel should follow the student as they move between papers.

## Options
| Option | How it works | Upside | Cost | What gets hard |
|---|---|---|---|---|
| A. Site list + on-click (the SVC1 plan) | `content_scripts` on a fixed list of publishers; `activeTab` + `scripting` for any other page | Automatic on main publishers, one click elsewhere | Install warning naming the listed sites; two code paths | Keeping the list current; depends on a Chrome behaviour that turned out not to hold (below) |
| B. Site list only | `content_scripts` on the list, nothing else | Fewest permissions, one code path | Install warning; journals off the list get no detection until manual DOI entry exists | Regional journals |
| C. On-click only | `activeTab` + `scripting`, no host access | No site warning; no page is read until the student clicks | A new click after each navigation; panel cannot follow the student | Result-list badges (VW2) and "automatic" flows |
| D. All sites | `content_scripts` on `<all_urls>` | Full coverage, simplest | "Read all your data on all websites" warning; runs on every page visited, including banking and email | Trust, store review; conflicts with least privilege |

**Rejected: D.** Reading every page a student visits to serve one feature is not defensible under rule 1.

## Decision
The owner chose A, with `activeTab` + `scripting` added only if real Chrome testing showed that a toolbar click grants `activeTab` while `openPanelOnActionClick` is on.

**It does not.** Google Chrome 156 stable, headed, scratch build with both permissions, on `https://example.com/`, 2026-11-05:

| Step | `chrome.scripting.executeScript` |
|---|---|
| Before clicking | refused (control) |
| After clicking Extensions menu → BioVidGen (the side panel opened) | refused |

So **option B ships**: `content_scripts` on the list below, no `activeTab`, no `scripting`, no `host_permissions`.

Sites (`extension/src/detect/sites.json`): PubMed, PMC, Europe PMC, bioRxiv, medRxiv, ScienceDirect, SpringerLink, BMC, Wiley, MDPI, Frontiers, PLOS, SciELO (Mexico, Brazil and `*.scielo.org`), Redalyc.

## Consequences
Good:
- No page outside the list is ever read.
- Detection stays local: no network in the detect bundle (OP1-SEC-01).
- One code path. The URL fallback for PDFs was not needed either: the content script runs in Chrome's PDF viewer (PLOS PDF, Chrome 156, 2026-11-05).

Bad:
- The install dialog gains a site-access warning.
- **Journals off the list get no automatic detection.** This matters for regional journals. The student can type or paste the DOI in the panel (delta D33): no permission needed, and the page is still never read. It costs a step, and the DOI stays unchecked until OP3 exists.
- Adding a host later makes Chrome ask existing users to re-approve, so the list should change rarely.
- The content script runs in hostile pages. It must stay unprivileged: no settings, no keys, no network.
- Detection loads 101 KB of script on listed pages, mostly Zod (no budget set; revisit if page load suffers).

## Revisit when
- Fixtures or pilot use show a large share of papers read outside the list. The local log counts typed DOIs (`doiSource.manual`), which measures this.
- Someone wants on-click again. **Untested alternative:** turn `openPanelOnActionClick` off and call `chrome.sidePanel.open()` from `action.onClicked`, where an `activeTab` grant is documented. It needs a new spike and the owner's approval, since it adds two permissions.
