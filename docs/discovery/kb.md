# BioVidGen — Discovery Knowledge Base

Run: discovery-process-mapper · Mode: **Light discovery + full-depth mapping** (non-commercial adaptation) · Started 2026-11-05
Resumable: each entry lists findings and sources. Confidence: 🟢 primary source read · 🟡 secondary/aggregator or single study · 🔴 assumption.

### 2026-11-05 — Task 0: Intake (from repo) — done
- Product: open-source (MIT), local-first Chrome MV3 extension; Spanish structured summary of English health-science papers with verbatim evidence quotes, plus preprint/retraction/expression-of-concern flags. $0 recurring cost. Source: `docs/process-design/tech-spec-v2-local-extension.md`, ADR-0006/0007. 🟢
- Segment: health-science undergraduates in Mexico; protocol waves up to 1,000 participants, Wave 4 = 700. Source: `docs/process-design/process-map.md`. 🟢 (repo), original protocol artifact `ChMWi4yjj8Qtq5W3xVJ7WN` **not reachable** this session (read_artifact: not found).
- Team: five people, two developers; QFB + physician available as domain experts. 🟢 (repo)
- EUBE trial removed from software scope (ADR-0006). Business model: none (free, academic). Stage: idea; code is a stub (`app/agent/main.py` docstring only, `ocr.py` empty). 🟢
- Blocking gaps: none (description + segment present). Non-blocking `[specify]`: partner institutions, target hardware, instructor buy-in.

### 2026-11-05 — Task 1: Market card — partial
- Health-sciences higher-education enrolment, Mexico 2023-24: **1,291,096 students, 13.1% of 4,926,166** (ANUIES indicator by field of study). Likely licenciatura/TSU only, excludes posgrado (inferred from SEP total 5,393,387). Source: https://ampliacioncobertura.anuies.mx/indicadores ; SEP principales cifras https://www.planeacion.sep.gob.mx/Doc/estadistica_e_indicadores/principales_cifras/principales_cifras_2023_2024_bolsillo.pdf . 🟡 (via search summary; page ~2 years old)
- Market type: **Resegmented** (AI research assistants exist; this resegments by language = Spanish, price = $0, and evidence-first pedagogy). 🔴 judgement.
- English barrier: UAM (CDMX) entering medical students, English reading test **67.8% fail, mean 52.5**; single institution. Source: Rev. Educación UCR, DOI 10.15517/revedu.v49i2.873 https://revistas.ucr.ac.cr/index.php/reducacion/article/view/873 . 🟡
- Reading time penalty for non-native speakers: up to +90.8% (Amano et al. 2023, cited in protocol per process-map.md). 🟡 (not re-read this session)
- GenAI already used by med students: Puerto Rico 2024, 72.7% use GenAI, 89.9% of them ChatGPT, mainly academic; experienced users say it helps understand papers. Source: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12135314/ . 🟡 (n=194, not Mexico)

### 2026-11-05 — Task 3: Competitive landscape — done
- Direct (AI paper assistants, freemium): Elicit (free tier, caps disputed; Pro ≈$49/user/mo per one Oct-2026 checker), SciSpace (free, capped Copilot; Premium ≈$12–20/mo), Consensus (free unlimited search, ~10 Pro messages/mo; Pro ≈$10–15/mo). Sources: https://costbench.com/software/ai-research-tools/elicit/free-plan , https://costbench.com/software/ai-research-tools/scispace/ , https://intercom.help/consensus-d118a252369c/en/articles/10087865-subscription-plans . 🟡 (aggregators disagree; vendor pages not read)
- Substitute for flags: **Citicious** (open source, MIT, Chrome; Retraction Watch via Crossref; banner + per-reference badges; EoC/corrections shown separately), Retraction Alert, RetractCheck, Manusights Reference Sentry (bioRxiv), Zotero + Retraction Watch (since 2019). Source: https://gh.r-mj.com/choxos/citicious , https://chromewebstore.google.com/detail/retraction-alert/lcpdiodcbbmlgindmohlahaeglflacjb , https://retractionwatch.com/category/rw-announcements/page/6 . 🟡 (licence/code not inspected)
- Indirect: free ChatGPT / Gemini / Copilot (paste or upload → Spanish summary), browser translation (Chrome/Edge/DeepL). Potential: AI built into the browser (Gemini in Chrome) and into PubMed/publisher sites. 🔴 (not verified this session)
- Do nothing: read with translator, ask peers/teacher.

### 2026-11-05 — Task 5: TAM/SAM/SOM (users, not $) — done (ranges)
- TAM = 1.29 M health-science students (🟡). SAM = TAM × 0.4–0.6 (in years/courses requiring English article reading, 🔴) × 0.6–0.75 (desktop Chrome/Chromium on own laptop, 🔴) ≈ **310k–580k**. SOM (24 mo) = partner-institution cohorts reached via instructors ≈ **1,000–5,000 installs** (🔴; anchored on protocol waves 1,000 + 700).

### 2026-11-05 — Task 7: JTBD + Job Map — done (assumed scores)
- Importance/satisfaction are **assumed** (no interviews; Light mode). Top OS: Execute (read & comprehend methods/results in English) 15; Monitor (verify understanding/summary against text) 13; Conclude (produce appraisal for class/club) 12; Prepare = 8 for students but 15 for instructors (normative need — students under-value retraction checks). 🔴

### 2026-11-05 — Tasks 10–14, 18a: Strategy — done
- Lean Canvas, SWOT, OST, RICE in `discovery-process-map.md`. RICE top: Export to appraisal sheet (cheap), status flags, evidence summary. 🔴 (effort estimates)
- Main scenario: students in partner journal clubs/courses, reached through instructors; $0; sustained as academic project.

### 2026-11-05 — Gate 1 — done
- Verdict **Go with risks**. One amber flag: differentiation vs free general LLMs and free retraction extensions. Readiness 4/8 (adapted). Top risky hypotheses: H-V2 beats free ChatGPT/Gemini on evidence-checked value; H-S1 $0 provider reaches gate on student hardware; H-D1 instructors drive installs.

### 2026-11-05 — Phase B + Gate 2 — done
- Ops re-mapped to v2 scope; OP5 split into LLM summarize + deterministic validate; new OP13 export, OP14 feedback; OP11 concierge = gold set. Team recurring cash cost/paper = $0; user quota headroom ≥12× on worst-case free tier (🟡). Fixed human cost dominates: gold set ≈ 90–135 expert hours (🔴).
