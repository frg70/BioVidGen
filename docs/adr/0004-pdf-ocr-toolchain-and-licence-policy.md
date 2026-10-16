# 0004 — PDF/OCR toolchain and dependency licence policy

Status: Proposed, **verified 2026-10-08** (PyMuPDF AGPL confirmed on PyPI; pypdfium2 BSD-3/Apache-2.0, pypdf BSD-3, pdfminer.six MIT) · Type 1 (licence promise is public)

## Context
The protocol promises MIT licensing with explicit commercial reuse from the first public commit. Copyleft dependencies (AGPL/GPL) would contradict that. Licences below are `[verify]` against current releases.

## Decision
- Policy: permissive dependencies only (MIT/BSD/Apache/MPL-compatible case by case). CI fails on AGPL/GPL via a licence scanner; SBOM generated per release.
- Text pipeline (waterfall): OA full text via API → PDF text layer (`pdfminer.six` / `pypdfium2` / `pypdf`) → **GROBID** (Apache-2.0) for sections and references → **Tesseract** (Apache-2.0, `spa+eng`) for scans → abstract-only mode.
- **Excluded**: PyMuPDF (AGPL) and Ghostscript (AGPL), including as transitive dependencies of OCR wrappers.
- Parsing of untrusted PDFs runs in a sandboxed worker container with no credentials and restricted network.

## Alternatives rejected
- PyMuPDF: best-in-class speed, but AGPL.
- Cloud OCR/document AI: only if governance allows sending uploaded PDFs; not default.

## Consequences
+ Licence promise holds; sandbox limits PDF-parser attack surface.
− Slower/less polished text extraction than PyMuPDF; GROBID is a Java service to run.

## Revisit when
Measured char-error rate or section recall fails the OP4 acceptance threshold; a permissive library reaches parity with an excluded one; legal advises otherwise.
