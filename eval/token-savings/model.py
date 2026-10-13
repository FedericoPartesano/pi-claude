"""Token-cost model calibrated on real Pi sessions (~/.pi/agent/sessions).

Rebuilds, for every model call of a session, the context that was sent (system+tools, user messages, assistant
messages, tool results, memory messages, compaction summaries), then prices it with a prefix-cache model:
  cost = cached_prefix*R + (context - cached_prefix)*W + output*O      (token-equivalents: R=0.1, W=1.25, O=5)
The cached prefix is the longest common prefix with the previous call's context, if that call was less than TTL ago.
Run `python3 -I model.py` to validate the baseline against the real usage numbers.
"""
import glob, json, os
from datetime import datetime

R, W, O = 0.1, 1.25, 5.0
SESSIONS = os.path.expanduser("~/.pi/agent/sessions/*/*.jsonl")


def ts(entry):
    return datetime.fromisoformat(entry["timestamp"].replace("Z", "+00:00")).timestamp()


def text_of(content):
    if isinstance(content, str):
        return content
    out = []
    for block in content or []:
        if block.get("type") == "text":
            out.append(block.get("text", ""))
        elif block.get("type") == "toolCall":
            out.append(json.dumps(block.get("arguments", {})))
        elif block.get("type") == "thinking":
            out.append(block.get("thinking", ""))
        elif block.get("type") == "image":
            out.append("x" * 4000)
    return "".join(out)


def load(path):
    """-> list of calls: {t, ctx:[item...], out, real:{read,write,input,out}} and compaction costs."""
    entries = []
    for line in open(path):
        try:
            entries.append(json.loads(line))
        except Exception:
            pass
    items, calls, extra = [], [], []
    by_id = {}
    args_of = {}
    for e in entries:
        kind = e.get("type")
        if kind == "message":
            m = e["message"]
            role = m.get("role")
            if role == "system":
                continue
            if role == "assistant" and m.get("usage"):
                u = m["usage"]
                calls.append({"t": ts(e), "ctx": list(items), "out": u.get("output", 0),
                              "real": {"read": u.get("cacheRead", 0), "write": u.get("cacheWrite", 0), "input": u.get("input", 0), "out": u.get("output", 0)}})
            split = {"th": 0, "tx": 0, "ared": 0, "aro": 0}
            if role == "assistant":
                for block in m.get("content") or []:
                    bt = block.get("type") if isinstance(block, dict) else None
                    if bt == "thinking": split["th"] += len(block.get("thinking", ""))
                    elif bt == "text": split["tx"] += len(block.get("text", ""))
                    elif bt == "toolCall":
                        n_ = len(json.dumps(block.get("arguments", {})))
                        split["ared" if block.get("name") in ("edit", "write") else "aro"] += n_
                for block in m.get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "toolCall":
                        args_of[block.get("id")] = block.get("arguments", {})
            item = {"id": e["id"], "role": role, "tok": (m.get("usage") or {}).get("output") if role == "assistant" else None, "split": split, "chars": len(text_of(m.get("content"))), "tool": m.get("toolName"), "err": bool(m.get("isError")), "n": len(calls)}
            if role == "toolResult":
                a = args_of.get(m.get("toolCallId")) or {}
                item["call_id"] = m.get("toolCallId")
                item["cmd"] = str(a.get("command") or a.get("path") or a.get("query") or a.get("pattern") or "")[:200]
            items.append(item)
            by_id[e["id"]] = len(items) - 1
        elif kind == "custom_message":
            items.append({"id": e["id"], "role": "custom", "chars": len(text_of(e.get("content"))), "tool": None, "err": False, "n": len(calls)})
            by_id[e["id"]] = len(items) - 1
        elif kind == "compaction":
            u = e.get("usage") or {}
            extra.append({"t": ts(e), "read": u.get("cacheRead", 0), "write": u.get("cacheWrite", 0), "input": u.get("input", 0), "out": u.get("output", 0), "at": len(calls)})
            keep = by_id.get(e.get("firstKeptEntryId"))
            kept = items[keep:] if keep is not None else []
            items = [{"id": e["id"], "role": "summary", "chars": len(e.get("summary", "")), "tool": None, "err": False, "n": len(calls)}] + kept
            by_id = {it["id"]: i for i, it in enumerate(items)}
    return calls, extra


def real_cost(calls, extra):
    c = sum(x["real"]["read"] * R + x["real"]["write"] * W + x["real"]["input"] + x["real"]["out"] * O for x in calls)
    c += sum(x["read"] * R + x["write"] * W + x["input"] + x["out"] * O for x in extra)
    return c


def fit(calls):
    """Least squares on the non-assistant items: real_total - assistant_tokens = fixed + chars * tokens_per_char."""
    xs = [sum(i["chars"] for i in c["ctx"] if i.get("tok") is None) for c in calls]
    ys = [c["real"]["read"] + c["real"]["write"] + c["real"]["input"] - sum(i["tok"] for i in c["ctx"] if i.get("tok") is not None) for c in calls]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    var = sum((x - mx) ** 2 for x in xs) or 1
    slope = max(0.05, sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var)
    return max(0, my - slope * mx), slope


def usable(path_calls):
    return len(path_calls) >= 30 and sum(c["real"]["read"] + c["real"]["write"] for c in path_calls) > 0


def corpus(min_calls=30):
    out = []
    for path in glob.glob(SESSIONS):
        calls, extra = load(path)
        if len(calls) >= min_calls and usable(calls):
            fixed, tpc = fit(calls)
            out.append({"path": path, "name": os.path.basename(path)[:19], "calls": calls, "extra": extra, "fixed": fixed, "tpc": tpc})
    return sorted(out, key=lambda s: s["name"])


def tokens(item, s):
    return item["tok"] if item.get("tok") is not None else item["chars"] * s["tpc"]


def simulate(s, ttl=300.0, transform=None, keepalive=None):
    """Prices a session. transform(s, call_index, ctx_items) -> list of (key, tokens) describing the context actually sent.
    Without transform the real context is sent. Returns dict(cost, read, write, out)."""
    prev, prev_t = None, None
    total = {"read": 0.0, "write": 0.0, "out": 0.0, "input": 0.0, "per_call": []}
    for i, c in enumerate(s["calls"]):
        ctx = [(it["id"], tokens(it, s)) for it in c["ctx"]] if transform is None else transform(s, i, c["ctx"])
        seq = [("__fixed__", s["fixed"])] + ctx
        warm = prev is not None and (c["t"] - prev_t) <= ttl
        common = 0.0
        if warm:
            for a, b in zip(prev, seq):
                if a[0] != b[0] or abs(a[1] - b[1]) > 1e-6:
                    break
                common += a[1]
        elif prev is None or True:
            common = s["fixed"] * 0.0
        # the system prompt + tool block is also cached across sessions for a long time
        common = max(common, min(s["fixed"], 11000))
        size = sum(t for _, t in seq)
        common = min(common, size)
        total["read"] += common * R
        total["write"] += (size - common) * W
        total["out"] += c["out"] * O
        total["per_call"].append(common * R + (size - common) * W + c["out"] * O)
        prev, prev_t = seq, c["t"]
    total["cost"] = total["read"] + total["write"] + total["out"]
    return total


if __name__ == "__main__":
    data = corpus()
    print(f"{len(data)} sessioni (>=30 chiamate, con dati di cache)\n")
    print(f"{'sessione':20} {'chiam':>5} {'reale':>8} {'TTL5m':>8} {'err':>5} {'TTL1h':>8} {'err':>5}  fixed  tok/char")
    tr = t5 = t60 = 0
    for s in data:
        real = real_cost(s["calls"], [])  # compaction calls excluded: the model does not price them
        a = simulate(s, 300)["cost"]
        b = simulate(s, 3600)["cost"]
        tr += real; t5 += a; t60 += b
        print(f"{s['name']:20} {len(s['calls']):5} {real/1e6:8.2f} {a/1e6:8.2f} {(a/real-1)*100:+4.0f}% {b/1e6:8.2f} {(b/real-1)*100:+4.0f}%  {s['fixed']:5.0f}  {s['tpc']:.3f}")
    print(f"\nTOTALE reale {tr/1e6:.1f}M · modello TTL 5min {t5/1e6:.1f}M ({(t5/tr-1)*100:+.0f}%) · TTL 1h {t60/1e6:.1f}M ({(t60/tr-1)*100:+.0f}%)")
