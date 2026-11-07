# Implementation plans: BioVidGen P0 views

UI stack: Preact (MIT), plain CSS with design tokens, `_locales` es-MX first. All model and page text is rendered with `textContent`, never `innerHTML`. Order: VW5 → VW3 → VW1.

---

## VW5 · Diagnostics. Type: screen (hidden tab in side panel) · Roles: student, dev (via export)

1. **Purpose**: let someone debug a failure without remote logs. Success: a bug report includes diagnostics in ≥80% of issues (measure in pilot).
2. **Layout**: `DiagnosticsTab` > `EnvSummary` (extension version, Chrome version, provider availability, enabled flags) + `LogTable` (last 200) + `CopyButton`.
3. **Data**: `logs` (SVC0) `orderBy(seq).reverse().limit(200)`; Settings provider availability. Freshness: live (Dexie liveQuery). Volume: ≤200 rows.
4. **Logic**: states: loading → ready → empty. Client-side filter by `op` and `outcome` (200 rows, in-memory filter is enough). Copy builds redacted JSON `{env, logs}`. Keys and article text never appear: the log schema has neither.
5. **Actions**: `Copiar diagnóstico` → clipboard (user gesture); no operation.
6. **Access**: local user only. Nothing is transmitted.
7. **Label capture**: N/A, diagnostics are not labels.
8. **States & a11y**: the table has a caption and headers; the copy button has a status message in `aria-live`.
9. **Telemetry**: none (by design).
10. **Tests**: redaction (keys seeded in Settings never appear in the copy output), 200-row cap, empty state.
11. **Tasks**: tests 0.25 d → component 0.5 d.

## VW3 · Options. Type: screen (options page) · Roles: student

1. **Purpose**: set up a working $0 provider and understand what leaves the computer. Success: a non-technical student configures a provider in ≤10 min (part of the ≤15-min install NFR; observed with 5 students in P4).
2. **Layout**: `ProviderSection` (cards for Nano, Ollama, free key; each with status, `Probar`, instructions) · `KeySection` (password inputs, masked, free-tier acknowledgement checkbox with provider data terms text) · `ScholarlySection` (optional OpenAlex key and email) · `ListsSection` (filter mode; enabled sites with optional permission request) · `PrivacyTable` ("qué sale de tu computadora": host → data sent) · `DataSection` (export all, import, clear all).
3. **Data**: Settings via SVC6; probe results; privacy table generated from the same allowlist constant the e2e test uses (single source, so it cannot drift).
4. **Logic**: per-provider state machine `unknown → probing → available | downloadable | unavailable | error`. Nano `downloadable` shows the download size warning (≥22 GB free disk, per the dependency register) and starts the download only on click. Key input is validated by format and then by a test call on click. Settings save on change (debounced 300 ms), and `storage.onChanged` updates the panel.
5. **Actions → operations**:
   | Action | Operation | Confirmation | Idempotency | Feedback |
   |---|---|---|---|---|
   | Probar proveedor | SVC6 probe | no | per provider | status chip |
   | Guardar clave | SVC6 set | no | key replace | masked value |
   | Habilitar sitio de listas | `chrome.permissions.request` | browser prompt | per origin | enabled toggle |
   | Borrar todo | clear stores + keys | **yes**: shows the consequence ("se borrarán resúmenes, notas y claves") | — | toast |
6. **Access**: local user; keys masked after save (last 4 characters).
7. **Label capture**: N/A.
8. **States & a11y**: every control labelled; status not conveyed by colour alone (icon + text); keyboard order follows sections; contrast AA.
9. **Telemetry**: none.
10. **Tests**: probe state transitions with mocked providers; clear-all confirmation; privacy table equals the allowlist constant; axe; keys never rendered unmasked after reload.
11. **Tasks**: tests 0.5 d → provider section 1 d (after S1/S2) → keys and acknowledgement 0.5 d → lists and permissions 0.5 d → privacy and data 0.5 d.

## VW1 · Paper panel. Type: screen (side panel) · Roles: student

1. **Purpose**: understand an English paper in Spanish, check each claim against its quote, see status, and export. Success: time per article (H-V1), planted-error detection (H-V2), and the export rate in the pilot.
2. **Layout & components**:
   ```
   PaperPanel
   ├─ Header: title, authors (first 3 + "et al."), journal · year, DOI link, "¿Es este el artículo?" (when candidates)
   ├─ StatusChips: Preprint | Retractado | Expresión de preocupación | Corrección | "Sin retractación encontrada en {fuentes} al {fecha}" + "Revisar"
   ├─ Keywords (tagged by source on hover/focus)
   ├─ SummaryArea
   │   ├─ SourceBanner: "Fuente: texto de la página | Europe PMC | solo resumen" ; "cobertura parcial"
   │   ├─ TopicBlock: Tema principal; Conocimiento previo (etiqueta "no proviene del artículo")
   │   ├─ SectionCard ×3 (Metodología, Resultados, Conclusiones)
   │   │    ├─ status badge (verificado / no verificado / solo resumen / falló)
   │   │    ├─ summaryEs (hidden behind "Mostrar de todos modos" when no_verificado)
   │   │    ├─ EvidenceList: quote (original language) + section label, expandable
   │   │    └─ MarkButton (P3: OP14)
   │   └─ ProviderBadge: proveedor · modelo
   ├─ Actions: Resumir | Exportar | (P3) Marcar
   └─ Footer: aviso "El resumen puede contener errores; verifica con las citas." · Diagnostics tab link
   ```
3. **Data**:
   | Component | Data | Source | Freshness | Volume |
   |---|---|---|---|---|
   | Header | PageContext.*, Article.{title, authors, journal, year, doi} | messaging + `scholarly.getArticle` | per navigation; 30 d cache | 1 |
   | StatusChips | StatusCheck latest | `scholarly.latestStatus` + re-check on open | re-checked on every open | 1 |
   | SummaryArea | Summary latest by DOI (`summaries` index `doi`, newest) | `summary.getLatest` | cached until pipelineVersion changes | 1 (≤20 KB) |
   No dedicated read model is needed: these are point lookups and the data is small.
4. **View logic**: state machine (XState-like reducer, hand-written):
   ```mermaid
   stateDiagram-v2
     [*] --> noArticle
     noArticle --> resolving: PaperDetected
     resolving --> ready: ArticleResolved
     resolving --> metaFromPage: NOT_FOUND
     ready --> ready: StatusChecked
     ready --> acquiring: Resumir
     metaFromPage --> acquiring: Resumir
     acquiring --> summarizing: TextAcquired
     acquiring --> ready: NO_TEXT, banner
     summarizing --> summarizing: SectionValidated k of 4
     summarizing --> summaryReady: SummaryStored
     summarizing --> ready: PROVIDER_UNAVAILABLE, QUOTA, TIMEOUT
     summaryReady --> acquiring: Resumir, other provider
     note right of summarizing
       Navigating to another paper aborts and returns to noArticle
     end note
   ```
   *Figure — VW1 states: every failure returns to `ready` with metadata and status still shown (the panel never goes blank); sections render one by one during `summarizing`.* Error states carry a next step ("configura un proveedor").
   Derived fields are computed in the client: the status text (shared `statusText()`) and the authors' display. Caching: no extra cache beyond the module caches; invalidation happens when a new pipelineVersion is stored or the user clicks re-check. Validation: none (no free input except the DOI paste box, which goes through `normalizeDoi`).
5. **Actions → operations**:
   | Action | Operation | Confirmation | Idempotency | Feedback |
   |---|---|---|---|---|
   | Resumir | OP4 → OP5 → OP5V | first time with a free-tier key: confirm the data notice | doi+pipelineVersion | progress k/4, per-section render |
   | Revisar estado | OP12 (panel) | no | doi+day | chip refresh with date |
   | Exportar | OP13 | no | summaryKey+template | "Copiado" toast / download |
   | Confirm paper / paste DOI | OP1 override → OP3 | no | doi | header refresh |
   | Mostrar de todos modos (no_verificado) | none (view only) | no | — | text revealed, with a warning style |
6. **Access**: local user. No masked fields. The provider name is shown, but never key material.
7. **Label capture**: P3, through OP14 MarkButton (next batch). P0 has none.
8. **States & a11y**: loading skeletons with `aria-busy`; section progress announced through `aria-live="polite"`; chips carry text and icons (never colour alone); quotes are `<blockquote lang="en">`; keyboard: Tab order follows the visual order, expand/collapse quotes with Enter/Space; focus stays after re-render; contrast AA; panel width 320–480 px responsive.
9. **Telemetry**: none remote. Local log entries per action (via SVC0). Pilot measures task time externally.
10. **Tests**: reducer transition table (every state × event); rendering snapshots for each status chip and each section status; `textContent` rendering of hostile strings; e2e on 3 publisher fixtures: detect → header → status → Resumir (stub provider) → sections → export; perf: first header paint ≤300 ms after panel open (warm); axe clean.
11. **Tasks**:
    | # | Task | Depends | Estimate | Done when |
    |---|---|---|---|---|
    | 1 | Reducer and transition tests, hostile-string tests (red) | — | 0.5 d | failing |
    | 2 | Header, StatusChips, Keywords | OP3, OP12 | 1 d | P0 e2e header and status green |
    | 3 | SummaryArea with stub provider; SectionCard statuses; EvidenceList | OP5 stub, OP5V | 1–1.5 d | skeleton e2e green |
    | 4 | Export action and toast | OP13 | 0.25 d | e2e export green |
    | 5 | a11y pass (axe, keyboard script) | 2–4 | 0.5 d | axe clean |
    | 6 | P3: progressive render from real providers, errors with next steps, MarkButton | OP5, OP14 | 1 d | P3 e2e green |
