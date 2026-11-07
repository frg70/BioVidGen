"""OP3 spike (H1, H2, H3): field coverage and latency on a sample of health-science DOIs. Dev-time only, live network.

Usage: uv run python scripts/spike_op3.py <output dir outside the repo> [--per-year 17] [--seed 3] [--regional]

Raw responses hold abstracts that may not be redistributable: never commit the output dir. Commit the numbers.
The sample comes from Europe PMC (MEDLINE records with a DOI): a random day per draw, a random hit on that day.
--regional samples Latin American journals through Crossref instead, so it only sees DOIs Crossref holds.
"""

import argparse
import concurrent.futures
import json
import random
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

UA = "BioVidGen-spike/0.1 (https://github.com/frg70/BioVidGen)"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
OPENALEX = "https://api.openalex.org/works/doi:"
CROSSREF = "https://api.crossref.org/works/"
OA_FIELDS = (
    "id,doi,display_name,publication_year,type,ids,authorships,is_authors_truncated,keywords,topics,primary_topic,"
    "primary_location,best_oa_location,open_access,abstract_inverted_index"
)
FIRST_YEAR = 2015
LAST_YEAR = 2026
LAST_DAY = date(2026, 10, 31)  # recent days are thin in the index
REGIONAL_ISSNS = (
    "0036-3634",  # Salud Publica de Mexico
    "0016-3813",  # Gaceta Medica de Mexico
    "0034-8376",  # Revista de Investigacion Clinica
    "1405-9940",  # Archivos de Cardiologia de Mexico
    "0443-5117",  # Revista Medica del IMSS
    "0120-4157",  # Biomedica
    "1020-4989",  # Revista Panamericana de Salud Publica
    "0716-1018",  # Revista Chilena de Infectologia
)


def get(url: str) -> tuple[int, bytes, float]:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})  # noqa: S310 fixed https hosts
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=15) as response:  # noqa: S310
            return response.status, response.read(), time.perf_counter() - start
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.perf_counter() - start
    except OSError:
        return 0, b"", time.perf_counter() - start


def draw_doi(year: int, rng: random.Random) -> str | None:
    last = min(date(year, 12, 31), LAST_DAY)
    day = date(year, 1, 1) + timedelta(days=rng.randrange((last - date(year, 1, 1)).days + 1))
    query = urllib.parse.urlencode(
        {
            "query": f"SRC:MED AND FIRST_PDATE:{day} AND DOI:*",
            "resultType": "lite",
            "pageSize": 100,
            "format": "json",
        }
    )
    status, body, _ = get(f"{EPMC}?{query}")
    if status != 200:
        return None
    hits = [h["doi"] for h in json.loads(body).get("resultList", {}).get("result", []) if h.get("doi")]
    return rng.choice(hits).lower() if hits else None


def sample(per_year: int, seed: int) -> dict[str, int]:
    rng = random.Random(seed)  # noqa: S311 sampling, not secrets
    draws = [(y, random.Random(rng.random())) for y in range(FIRST_YEAR, LAST_YEAR + 1) for _ in range(per_year)]  # noqa: S311
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        found = list(pool.map(lambda d: draw_doi(*d), draws))
    return {doi: year for (year, _), doi in zip(draws, found, strict=True) if doi}


def sample_regional(per_journal: int) -> dict[str, int]:
    dois: dict[str, int] = {}
    for issn in REGIONAL_ISSNS:
        status, body, _ = get(f"{CROSSREF.replace('works/', 'journals/')}{issn}/works?sample={per_journal}&select=DOI")
        found = [i["DOI"].lower() for i in json.loads(body)["message"]["items"]] if status == 200 else []
        print(f"{issn}: {len(found)} DOIs (status {status})")
        dois.update(dict.fromkeys(found, 0))
    return dois


def fetch(doi: str, out: Path, index: int) -> dict[str, object]:
    encoded = urllib.parse.quote(doi, safe="/")
    start = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(2) as pool:  # the two hosts in parallel, as OP3 will
        oa = pool.submit(get, f"{OPENALEX}{encoded}?select={OA_FIELDS}")
        cr = pool.submit(get, f"{CROSSREF}{encoded}")
        (oa_status, oa_body, oa_s), (cr_status, cr_body, cr_s) = oa.result(), cr.result()
    both_s = time.perf_counter() - start
    (out / f"{index:03d}.oa.json").write_bytes(oa_body)
    (out / f"{index:03d}.cr.json").write_bytes(cr_body)
    return {
        "doi": doi,
        "oa_status": oa_status,
        "cr_status": cr_status,
        "oa_bytes": len(oa_body),
        "cr_bytes": len(cr_body),
        "oa_s": oa_s,
        "cr_s": cr_s,
        "both_s": both_s,
        "index": index,
    }


def pct(hits: int, total: int) -> str:
    return f"{hits}/{total} = {100 * hits / total:.1f}%" if total else "0/0"


def p95(values: list[float]) -> float:
    return statistics.quantiles(values, n=20, method="inclusive")[18]


def report(rows: list[dict], out: Path) -> None:
    n = len(rows)
    tally: dict[str, int] = {}

    def count(key: str, hit: object) -> None:
        tally[key] = tally.get(key, 0) + bool(hit)

    for row in rows:
        oa = json.loads((out / f"{row['index']:03d}.oa.json").read_bytes()) if row["oa_status"] == 200 else {}
        cr_raw = json.loads((out / f"{row['index']:03d}.cr.json").read_bytes()) if row["cr_status"] == 200 else {}
        cr = cr_raw.get("message", {})
        oa_authors = bool(oa.get("authorships"))
        cr_authors = bool(cr.get("author"))
        oa_kw = bool(oa.get("keywords"))
        oa_kw_03 = any((k.get("score") or 0) >= 0.3 for k in oa.get("keywords") or [])
        oa_topics = bool(oa.get("topics"))
        cr_subject = bool(cr.get("subject"))
        ids = oa.get("ids") or {}
        location = oa.get("primary_location") or {}
        count("oa_found", row["oa_status"] == 200)
        count("cr_found", row["cr_status"] == 200)
        count("any_found", row["oa_status"] == 200 or row["cr_status"] == 200)
        count("oa_authors", oa_authors)
        count("cr_authors", cr_authors)
        count("oa_keywords", oa_kw)
        count("oa_keywords_score_0.3", oa_kw_03)
        count("oa_topics", oa_topics)
        count("oa_keywords_or_topics", oa_kw or oa_topics)
        count("cr_subject", cr_subject)
        count("oa_coverage (author AND keyword/topic)", oa_authors and (oa_kw_03 or oa_topics))
        count(
            "merged_coverage (author AND keyword/topic)",
            (oa_authors or cr_authors) and (oa_kw_03 or oa_topics or cr_subject),
        )
        count("oa_abstract", oa.get("abstract_inverted_index"))
        count("cr_abstract", cr.get("abstract"))
        count("any_abstract", oa.get("abstract_inverted_index") or cr.get("abstract"))
        count("oa_type", oa.get("type"))
        count("cr_type", cr.get("type"))
        count("oa_pmid", ids.get("pmid"))
        count("oa_pmcid", ids.get("pmcid"))
        count("oa_journal", (location.get("source") or {}).get("display_name"))
        count("oa_is_oa", (oa.get("open_access") or {}).get("is_oa"))
        count("oa_authors_truncated", oa.get("is_authors_truncated"))
    print(f"sample: {n} DOIs")
    for key, hits in tally.items():
        print(f"{key}: {pct(hits, n)}")
    for key in ("oa_s", "cr_s", "both_s"):
        values = [r[key] for r in rows]
        print(f"{key}: p50 {statistics.median(values):.3f} s, p95 {p95(values):.3f} s, max {max(values):.3f} s")
    for key in ("oa_bytes", "cr_bytes"):
        values = [float(r[key]) for r in rows]
        print(f"{key}: p50 {statistics.median(values) / 1024:.1f} KB, p95 {p95(values) / 1024:.1f} KB")
    errors = [r["oa_status"] for r in rows if r["oa_status"] not in (200, 404)]
    errors += [r["cr_status"] for r in rows if r["cr_status"] not in (200, 404)]
    print(f"statuses other than 200/404: {errors}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("out", type=Path)
    parser.add_argument("--per-year", type=int, default=17)
    parser.add_argument("--seed", type=int, default=3)
    parser.add_argument("--regional", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rows_path = args.out / "rows.json"
    if rows_path.exists():
        rows = json.loads(rows_path.read_text("utf-8"))
    else:
        dois = sample_regional(25) if args.regional else sample(args.per_year, args.seed)
        (args.out / "dois.json").write_text(json.dumps(dois, indent=1), "utf-8")
        rows = []
        for index, doi in enumerate(dois):
            rows.append(fetch(doi, args.out, index))
            time.sleep(0.25)  # stays under the Crossref public pool's 5 requests per second
        rows_path.write_text(json.dumps(rows), "utf-8")
    report(rows, args.out)


if __name__ == "__main__":
    main()
