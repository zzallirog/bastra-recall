#!/usr/bin/env python3
"""#628 tables on Daniel's registered 44 scenarios (his scenarios.json, sent 09-23 20:42), not on the re-mine.

43 of 44 (commit, file, truth) match a re-mined row exactly, so their arm results are reused as they are.
S32 (session-context.ts @73ae1a83) was never accepted by the re-mine: on Linux its diff breaks nothing (the truth
test is green at parent and at parent+diff, 5/5), so it is evaluated once with his truth (edge-sources-S32.json).
usage: exact44.py <daniel scenarios.json> <edge-sources.json> <edge-sources-S32.json> <coverage map-fn.json>
"""
import json, sys

dan, es, es32, covmap = sys.argv[1:5]
D = json.load(open(dan))["scenarios"]
pool = {(r["commit"], r["file"]): r for r in json.load(open(es))["rows"] + json.load(open(es32))["rows"]}
M = json.load(open(covmap))
rows = []
for s in D:
    r = dict(pool[(s["commit"], s["file"])])
    assert sorted(r["truth"]) == sorted(s["truth"]), s["id"]
    r["id"] = s["id"]
    rows.append(r)


def cov_capped(r, cap):
    bare = {str(n).removesuffix("()").split(".")[-1] for n in r.get("changedFunctions", [])}
    ranked = sorted(r.get("byCoverage", []), key=lambda t: (-len(set(M.get(t, {}).get(r["file"], [])) & bare), t))[:cap]
    named = set(r["listed"]) | set(ranked)
    return {"covers": bool(named & set(r["truth"])),
            "extra": len([f for f in named if f not in r["truth"] and f not in r["listed"]])}


for r in rows:
    if "diag_fn_coverage" in r["arms"]:
        r["arms"]["diag_fn_coverage_cap5"] = cov_capped(r, 5)

ARMS = [("graph", "graph, as shipped"), ("graph_name", "+ name index"), ("graph_history", "+ path history"),
        ("graph_name_history", "+ name + path history"), ("graph_token", "+ token history"),
        ("graph_fn_history", "+ function history"), ("diag_graph_uncapped", "*diagnostic:* graph before the display cap of 10"),
        ("diag_fn_coverage", "*diagnostic:* function coverage, one map folded at `c0667f1d`"),
        ("diag_fn_coverage_cap5", "*diagnostic:* the same, capped at 5 lines"),
        ("diag_static_closure", "*diagnostic, circular:* every test whose static closure holds the file")]


def tot(sub, arm):
    d = [r for r in sub if r["delivered"] and arm in r["arms"]]
    s = [r for r in sub if not r["delivered"]]
    return (sum(r["arms"][arm]["covers"] for r in d), len(d),
            sum(r["arms"].get(arm, {}).get("covers", False) for r in s), len(s),
            sum(r["arms"][arm]["extra"] for r in d) / max(1, len(d)))


nb = sum(r["delivered"] for r in rows)
half = [r for r in rows if r.get("danglingImports")]
clean = [r for r in rows if not r.get("danglingImports")]
print(f"{len(rows)} scenarios (Daniel's registered set), {nb} blocks, {len(rows)-nb} silent: "
      + " ".join(r["id"] for r in rows if not r["delivered"]))
print(f"half-applied {len(half)} ({100*len(half)/len(rows):.0f} %): " + " ".join(r["id"] for r in half) + "\n")
print(f"| arm | blocks naming a truth file (of {nb}) | names truth where the graph is silent (of {len(rows)-nb}) | extra files per block |")
print("|---|---|---|---|")
for arm, label in ARMS:
    c, n, cs, s, ex = tot(rows, arm)
    print(f"| {label} | {c} ({100*c/max(1,n):.0f} %) | {'—' if arm == 'graph' else cs} | {ex:.2f} |")
print()
print(f"| arm | clean: {len(clean)} sc., {sum(r['delivered'] for r in clean)} blocks | half-applied: {len(half)} sc., {sum(r['delivered'] for r in half)} blocks |")
print("|---|---|---|")
for arm, label in ARMS:
    a, b = tot(clean, arm), tot(half, arm)
    f = lambda t: f"{t[0]} / {t[1]}" + (f", +{t[2]} silent" if t[2] else "")
    print(f"| {label.split(' (')[0]} | {f(a)} | {f(b)} |")
