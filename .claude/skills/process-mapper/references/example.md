# Worked example — Supplier invoice processing (calibration for operation-card depth)

Input: "We receive supplier invoices as PDF by email, someone types them into the ERP and checks them against purchase orders, then a manager approves payment."

## Process map
| ID | Operation | Input → Output | Class |
|---|---|---|---|
| OP1 | Ingest email | Mailbox → Document | DETERMINISTIC |
| OP2 | Extract fields | Document → Invoice (inferred) | LLM + deterministic validator |
| OP3 | Match to PO | Invoice + PO → MatchResult | DETERMINISTIC |
| OP4 | Score anomaly | Invoice history → RiskScore | TRAINABLE ML |
| OP5 | Approve payment | Invoice + MatchResult + RiskScore → Approval | HUMAN (above threshold) / DETERMINISTIC (below) |
| OP6 | Post to ERP | Approval → ERP record | DETERMINISTIC |

## Ontology excerpt
Invoice — key: (supplier_tax_id, invoice_no), natural; dedup on that pair. Invariant: `total = Σ line.amount + tax`. Interface: create (OP2), validate, match (OP3), approve (OP5). Relationship: Invoice 1:N InvoiceLine (composition); Invoice N:1 Supplier (reference); Invoice N:M PurchaseOrder (reference, optional).

| Property | Certainty | Visibility |
|---|---|---|
| total_amount | Inferred → Derived after validator | public |
| received_at | Measured | public |
| bank_account | Inferred → verified against Supplier master | protected (AP lead, OP6) |
| extraction_raw | Measured | internal (OP2) |

## Operation card

### OP2 · Extract fields — Class: LLM (+ deterministic validator, HUMAN on failure)
**Why**: layouts vary per supplier; templates break on each new one; no labels at start. **Knowledge**: document-layout understanding and semantic field mapping ("Total a pagar" → total_amount). **Hybrid**: validator checks the invariant, tax rate ∈ allowed set, tax-ID format; failures → human queue. **Migration signal**: if top 20 suppliers make up >80% of volume and ≥ [specify] corrections are logged, move them to template/NLP extraction for cost. **LLM context**: no retrieval; tools: none (output is schema-constrained JSON only).

**Properties**: encapsulated (writes Invoice only via create); idempotent via key (supplier_tax_id, invoice_no) — re-processing the same email does not duplicate; non-deterministic → model version pinned, temperature 0, variance measured on golden set; side effects: none (write happens at OP6); atomic per invoice; reversible (draft state); retry safe; order-independent; stateless.

**Failure modes**
| Mode | Effect | S | O | D | RPN | Mitigation |
|---|---|---|---|---|---|---|
| Wrong total | Wrong payment | 9 | 3 | 2 | 54 | Invariant check |
| Wrong bank account | Payment to attacker | 10 | 2 | 6 | 120 | Compare with Supplier master; any change → HUMAN + separation of duties |
| Prompt injection in PDF text | Manipulated fields | 8 | 2 | 5 | 80 | Treat document as data; schema-only output; no tools |

FP vs FN: flagging a correct invoice costs ~[specify] min of review; passing a wrong one can cost the full amount → bias threshold toward flagging.

**Cost/unit**: [specify: tokens × price] + validator ≈ negligible; compare with clerk minutes × hourly cost.
**Governance**: invoices contain supplier personal/financial data → confirm the model provider is allowed under LFPDPPP and company policy.
**Owner**: Accountable [specify: AP lead]; alerts → [specify: ops on-call].
**Access**: runs as `svc-extract`; C on Invoice draft fields; no R on Supplier.bank_account master; no U/D after OP3.

1. **Problem**: target = field-level accuracy; metrics: accuracy %, straight-through %, p95 latency s, cost/invoice.
2. **Data**: PDFs (row = invoice); instrument = supplier billing system or scanner (DPI limits resolution); error rate from 50-invoice audit.
3. **Information**: writes Invoice.* draft properties as Inferred; validator promotes them to Derived.
4. **Train/adjust**: baseline = clerk accuracy and time; tune schema, prompt and few-shot examples; corrections logged as labels.
5. **Evaluation**: 200-invoice golden set; accept at field accuracy ≥ [specify]% and validator pass ≥ [specify]%.
6. **Deploy**: event-triggered from OP1; 2 weeks shadow, then auto-pass on validator success; label capture on every correction.
7. **Monitor**: accuracy on 2% daily audit; validator-fail rate hourly; new-supplier share weekly; cost/invoice daily; denied-access events real-time.
8. **Adapt**: failures concentrated on one supplier → add example; global drop → error analysis on 30 cases, Pareto by field; cost > target → apply migration signal.
