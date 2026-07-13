#!/usr/bin/env python3
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "reference-model" / "src"))
from bleavit_reference_model.lmsr import vectors_v1_v6, cost, marginal_price_long, raw_64x64_nearest, fmt

def build():
    samples=[]
    for ql, qs in [(0,0),(1000,0),(2500,0),(0,2500),(12345,6789),(240000,0),(0,240000),(480000,0)]:
        c=cost(10000, ql, qs); p=marginal_price_long(10000, ql, qs)
        samples.append({"q_long": str(ql), "q_short": str(qs), "cost": fmt(c), "cost_raw_64x64_nearest": raw_64x64_nearest(c), "price_long": fmt(p), "price_raw_64x64_nearest": raw_64x64_nearest(p)})
    return {"schema":"bleavit.reference-model.v1","precision":"Python Decimal, 90 decimal digits (>=256-bit precision target)","lmsr_vectors":vectors_v1_v6(),"high_precision_corpus":{"b":"10000","samples":samples},"decision_scenarios":[{"name":"hurdle_met","delta":"0.06","hurdle":"0.05","outcome":"Adopt"},{"name":"below_hurdle","delta":"0.04","hurdle":"0.05","outcome":"Reject","reason":"HurdleNotMet"}],"ledger_scenarios":[{"name":"void_neutral_branch_usdc","input":"10.000000","payout":"5.000000"}]}

def main():
    p=argparse.ArgumentParser(); p.add_argument("--check", action="store_true"); p.add_argument("--out", default="reference-model/fixtures/vectors.json"); a=p.parse_args()
    text=json.dumps(build(), sort_keys=True, indent=2)+"\n"; path=Path(a.out)
    if a.check:
        if not path.exists() or path.read_text()!=text:
            raise SystemExit(f"{path} is stale; run tools/reference-model/generate-vectors.py")
    else:
        path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text)
if __name__ == "__main__": main()
