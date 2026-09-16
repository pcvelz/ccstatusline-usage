#!/usr/bin/env python3
"""harness-poll.py - empirical ccstatusline vs llama-swap slot check.

Polls, for a window of N seconds, BOTH sides of the contract and prints one
row per tick so any agent can prove (or disprove) that the status line a
tmux pane shows agrees with what llama-swap reports for that session:

  left  = the ccstatusline block captured from the tmux pane
          (State: word, Rate: t/s, C: bar text)
  right = llama-swap control plane: /api/events inflight snapshot joined to
          /api/slots, classified with the SAME rules the widgets use
          (PARKED first; resp_tokens > 0 or a moving n_decoded = DECODE;
          granted without output = PREFILL, FLAT after 60s without counter
          motion; no entry = NONE, which the pane's TURN hold also matches)

A tick is MATCH when the pane word equals the API word. Anything else is
MISMATCH and the row says why. The summary lists the phases observed, so a
run that never left PARKED is visibly not a full-phase proof.

Usage (normally via scripts/harness.sh):
  HARNESS_TMUX=<session> python3 scripts/harness-poll.py [--seconds 20] [--interval 2]

Env:
  HARNESS_TMUX        tmux session/pane target to capture (required)
  LLAMA_SWAP_BASE     control-plane base (default http://127.0.0.1:8001)
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

BASE = os.environ.get("LLAMA_SWAP_BASE", "http://127.0.0.1:8001")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


# ── tmux side ─────────────────────────────────────────────────────────────

def capture_pane(target):
    try:
        out = subprocess.run(["tmux", "capture-pane", "-t", target, "-p"],
                             capture_output=True, text=True, timeout=3).stdout
    except Exception:
        return ""
    return ANSI.sub("", out)


def parse_pane(text):
    """Return dict(session, word, rate, context) from the status block."""
    lines = [ln.rstrip() for ln in text.splitlines()]
    block = [ln for ln in lines[-12:] if re.match(r"^\s*(M:|S:|C:|Context:|State:)", ln)
             or "State:" in ln or "Rate:" in ln]
    joined = " | ".join(block)
    res = {"raw": joined}
    m = re.search(r"\bS:\s*([0-9a-f]{8})", joined)
    res["session"] = m.group(1) if m else None
    m = re.search(r"State:\s*([A-Z]+)", joined)
    res["word"] = m.group(1) if m else None
    m = re.search(r"Rate:\s*([0-9.]+)\s*t/s", joined)
    res["rate"] = float(m.group(1)) if m else None
    m = re.search(r"\b(C|Context|P|Prefill):\s*(\[[^\]]*\]\s*\S+)", joined)
    res["context"] = f"{m.group(1)}: {m.group(2)}" if m else None
    # The widget switches to the Prefill label and the arrow-head bar while
    # the slot is prefilling; either is the visible proof of prefill mode.
    res["blend"] = bool(m) and (m.group(1) in ("P", "Prefill") or "▶" in m.group(2))
    return res


# ── llama-swap side ───────────────────────────────────────────────────────

def curl(url, extra=None, max_time="2"):
    cmd = ["curl", "-s", "--max-time", max_time]
    if extra:
        cmd += extra
    cmd.append(url)
    try:
        return subprocess.run(cmd, capture_output=True, text=True,
                              timeout=float(max_time) + 1).stdout
    except Exception:
        return ""


def fetch_inflight():
    """Merged in-flight set from one /api/events batch (snapshot/upsert/remove)."""
    raw = curl(f"{BASE}/api/events", ["-N", "-H", "Accept: text/event-stream"], "1.5")
    by_id = {}
    for line in raw.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            env = json.loads(line[5:].strip())
            if env.get("type") != "inflight":
                continue
            p = json.loads(env["data"])
        except Exception:
            continue
        op = p.get("operation")
        if op == "upsert" and p.get("request", {}).get("id"):
            by_id[p["request"]["id"]] = p["request"]
        elif op == "remove" and p.get("id"):
            by_id.pop(p["id"], None)
        else:
            by_id = {r["id"]: r for r in (p.get("requests") or []) if r and r.get("id")}
    return list(by_id.values())


def fetch_slots():
    """Per-model slot rows from /api/slots, or None when the endpoint did not
    answer this tick (the proxy reads the child's /slots on demand, which can
    exceed the curl budget under load) - None is reported, never masked."""
    try:
        body = curl(f"{BASE}/api/slots", max_time="3")
        return json.loads(body).get("models", []) if body else None
    except Exception:
        return None


def is_parked(entry):
    md = entry.get("metadata") or {}
    return md.get("kv_parked") == "1" or md.get("slot_granted") != "1"


def join_slot(entry, models):
    if is_parked(entry):
        return None
    md = entry.get("metadata") or {}
    model_id = md.get("resolved_model") or entry.get("model")
    for m in models:
        if m.get("model") != model_id:
            continue
        aff = md.get("slot_affinity") or md.get("slot_id")
        if aff not in (None, ""):
            for s in m.get("slots", []):
                if str(s.get("id")) == str(aff):
                    return s
        proc = [s for s in m.get("slots", []) if s.get("is_processing")]
        return proc[0] if len(proc) == 1 else None
    return None


FLAT_WINDOW_S = 60  # mirrors FLAT_WINDOW_MS in src/utils/llama-swap.ts
_last_motion = {}   # session prefix -> (processed, decoded, epoch of last change)


def flat_word(session_prefix, slot, now):
    """PREFILL, or FLAT once the joined slot's counters have not moved for
    FLAT_WINDOW_S while the request is still granted - the same rule the
    widget applies (classifyWord), so a starved slot reads FLAT on both sides
    instead of the harness calling a stall PREFILL forever."""
    if not slot:
        return "PREFILL"
    key = (slot.get("n_prompt_tokens_processed", 0), slot.get("n_decoded", 0))
    prev = _last_motion.get(session_prefix)
    if prev is None or prev[:2] != key:
        _last_motion[session_prefix] = (key[0], key[1], now)
        # A moving n_decoded outranks a zero resp_tokens (the first decoded
        # tokens sit in the child's buffer before any SSE delta is sent).
        if prev is not None and key[1] > prev[1]:
            return "DECODE"
        return "PREFILL"
    return "FLAT" if now - prev[2] >= FLAT_WINDOW_S else "PREFILL"


def api_view(session_prefix):
    entries = fetch_inflight()
    models = fetch_slots()
    slots_ok = models is not None
    models = models or []
    entry = None
    for e in entries:
        sid = (e.get("metadata") or {}).get("session_id", "")
        if session_prefix and sid.startswith(session_prefix):
            entry = e  # newest match wins
    view = {"word": "NONE", "slot": None, "tokens": None, "reason": None,
            "models": models, "entry": entry, "slots_ok": slots_ok}
    if entry is None:
        return view
    md = entry.get("metadata") or {}
    slot = join_slot(entry, models)
    view["slot"] = slot
    view["tokens"] = entry.get("resp_tokens", 0)
    if is_parked(entry):
        view["word"] = "PARKED"
        view["reason"] = md.get("park_reason")
    elif (entry.get("resp_tokens") or 0) > 0:
        view["word"] = "DECODE"
    else:
        view["word"] = flat_word(session_prefix, slot, time.time())
    return view


# ── main loop ─────────────────────────────────────────────────────────────

def fmt_slot(slot, slots_ok=True):
    if not slots_ok:
        return "slot=UNAVAILABLE(/api/slots did not answer)"
    if not slot:
        return "slot=-"
    return (f"slot={slot.get('id')} proc={int(bool(slot.get('is_processing')))} "
            f"pp={slot.get('n_prompt_tokens_processed', 0)}/{slot.get('n_prompt_tokens', 0)} "
            f"dec={slot.get('n_decoded', 0)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=20)
    ap.add_argument("--interval", type=float, default=2)
    ap.add_argument("--verbose", "-v", action="store_true",
                    help="also print the raw pane status block and every slot row per tick")
    args = ap.parse_args()

    target = os.environ.get("HARNESS_TMUX")
    if not target:
        print("HARNESS_TMUX is required", file=sys.stderr)
        return 2

    deadline = time.time() + args.seconds
    ticks = matches = 0
    phases = set()
    mismatch_rows = []
    prev_dec = None
    prev_raw = None
    stale_ticks = 0

    while True:
        pane = parse_pane(capture_pane(target))
        api = api_view(pane["session"])
        if args.verbose:
            print(f"--- tick {ticks + 1} {datetime.now():%H:%M:%S}")
            print("  pane block : " + (pane["raw"] or "(no status block found)"))
            if not api["slots_ok"]:
                print("  slots      : /api/slots did not answer this tick")
            for m in api["models"]:
                for s_ in m.get("slots", []):
                    print(f"  slot {s_.get('id')} [{m.get('model')}] "
                          f"processing={s_.get('is_processing')} "
                          f"prompt={s_.get('n_prompt_tokens')} "
                          f"processed={s_.get('n_prompt_tokens_processed')} "
                          f"decoded={s_.get('n_decoded')}")
            e = api["entry"]
            if e:
                md = e.get("metadata") or {}
                print(f"  inflight   : id={e.get('id')} model={e.get('model')} "
                      f"resp_tokens={e.get('resp_tokens')} elapsed_ms={e.get('elapsed_ms')} "
                      f"slot_granted={md.get('slot_granted')} kv_parked={md.get('kv_parked')} "
                      f"slot_affinity={md.get('slot_affinity')} park_reason={md.get('park_reason')}")
            else:
                print("  inflight   : (no in-flight request for this session)")
        ticks += 1
        phases.add(api["word"])
        # TURN is the widget's 60s hold across a turn boundary (client running
        # a local tool): the API truthfully has no entry, so NONE matches it.
        ok = pane["word"] == api["word"] or (pane["word"] == "TURN" and api["word"] == "NONE")
        matches += int(ok)
        slot = api["slot"]
        api_rate = ""
        if slot and prev_dec is not None and prev_dec[0] == slot.get("id"):
            d = slot.get("n_decoded", 0) - prev_dec[1]
            dt = time.time() - prev_dec[2]
            if d > 0 and dt > 0:
                api_rate = f" ~{d / dt:.1f}t/s"
        if slot:
            prev_dec = (slot.get("id"), slot.get("n_decoded", 0), time.time())
        # A pane whose status block did not change since the last tick was
        # NOT re-rendered by Claude Code: its words are last render's truth,
        # not this tick's. Counted so the summary can say how live the pane is.
        stale = prev_raw is not None and pane["raw"] == prev_raw
        prev_raw = pane["raw"]
        stale_ticks += int(stale)
        pane_str = (f"State={pane['word']} Rate={pane['rate']} "
                    f"C={pane['context']}{' PREFILL-BAR' if pane['blend'] else ''}"
                    f"{' (stale)' if stale else ''}")
        api_str = f"word={api['word']}" + (f"({api['reason']})" if api["reason"] else "")
        api_str += f" tok={api['tokens']} {fmt_slot(slot, api['slots_ok'])}{api_rate}"
        verdict = "MATCH" if ok else "MISMATCH"
        row = f"{datetime.now():%H:%M:%S} [{pane['session']}] pane: {pane_str} | api: {api_str} | {verdict}"
        print(row, flush=True)
        if not ok:
            mismatch_rows.append(row)
        if time.time() >= deadline:
            break
        time.sleep(args.interval)

    print(f"SUMMARY ticks={ticks} match={matches} mismatch={ticks - matches} "
          f"pane-stale={stale_ticks} phases={','.join(sorted(phases))}")
    return 0 if matches == ticks else 1


if __name__ == "__main__":
    sys.exit(main())
