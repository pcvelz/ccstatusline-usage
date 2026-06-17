#!/usr/bin/env python3
"""Fallback Kimi usage extractor via the local Chromium CDP server.

When the Kimi billing API returns no usage data (anonymous/unauthenticated),
this script reads the already-open https://www.kimi.com/code/console page from
localhost:9222 and parses the visible weekly usage and rate-limit percentages.
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any


def _iso_in_hours(hours: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(
        timespec="seconds"
    ).replace("+00:00", "Z")


def _parse_hours(text: str) -> int | None:
    match = re.search(r"(\d+)\s*(?:hour|hours|hr)", text, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


def _fetch_page_text(ws_url: str) -> str:
    import websocket  # type: ignore[import]

    ws = websocket.create_connection(ws_url, timeout=10)
    try:
        ws.send(
            json.dumps(
                {
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {"expression": "document.body.innerText", "returnByValue": True},
                }
            )
        )
        response = json.loads(ws.recv())
        result = response.get("result", {}).get("result", {})
        return result.get("value", "")
    finally:
        ws.close()


def _extract_usage(text: str) -> dict[str, Any]:
    weekly_match = re.search(
        r"Weekly usage\s*(\d+)%\s*Resets in\s*(.+?)(?:\n|\r)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    rate_match = re.search(
        r"Rate limit details\s*(\d+)%\s*Resets in\s*(.+?)(?:\n|\r)",
        text,
        re.IGNORECASE | re.DOTALL,
    )

    result: dict[str, Any] = {"provider": "kimi", "source": "cdp"}
    if weekly_match:
        result["weeklyUsage"] = int(weekly_match.group(1))
        hours = _parse_hours(weekly_match.group(2))
        if hours is not None:
            result["weeklyResetAt"] = _iso_in_hours(hours)
    if rate_match:
        result["sessionUsage"] = int(rate_match.group(1))
        hours = _parse_hours(rate_match.group(2))
        if hours is not None:
            result["sessionResetAt"] = _iso_in_hours(hours)
    return result


def main() -> int:
    try:
        targets = json.load(urllib.request.urlopen("http://localhost:9222/json", timeout=5))
        ws_url = next(
            (
                t["webSocketDebuggerUrl"]
                for t in targets
                if t.get("url") == "https://www.kimi.com/code/console"
            ),
            None,
        )
        if not ws_url:
            print(json.dumps({"provider": "kimi", "source": "cdp", "error": "no kimi console target"}))
            return 1

        text = _fetch_page_text(ws_url)
        usage = _extract_usage(text)
        if "weeklyUsage" not in usage and "sessionUsage" not in usage:
            print(json.dumps({"provider": "kimi", "source": "cdp", "error": "usage not found in DOM"}))
            return 1

        print(json.dumps(usage))
        return 0
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"provider": "kimi", "source": "cdp", "error": str(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
