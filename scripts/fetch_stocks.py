#!/usr/bin/env python3
"""Fetch stock prices from NYSE API with Schwab HTML fallback."""

import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

NYSE_URL = "https://www.nyse.com/api/nyseservice/v1/quotes?symbol="
CS_URL = "https://www.schwab.wallst.com/Prospect/Research/mutualfunds/fees.asp?symbol="

RE_TABLE = re.compile(r"^[\s\S]*(<table id=\"firstGlanceQuoteTable\".*?</table>)[\s\S]*$", re.DOTALL)
RE_PRICE = re.compile(r"^.*?<tbody><tr><td>\$([0-9.]+)</td>.*$")
RE_CHANGE = re.compile(r"^.*?<tbody><tr><td>\$[0-9.]+</td><td><span.*?>([+-]?[0-9.]+)</span>.*$")


def fetch_nyse(ticker):
    req = urllib.request.Request(
        NYSE_URL + ticker,
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    price = data.get("quote", {}).get("last")
    change = data.get("quote", {}).get("change")
    if price is not None and re.match(r"^[0-9.]+$", str(price)):
        return {"price": float(price), "change": float(change or 0)}
    return None


def fetch_schwab(ticker):
    req = urllib.request.Request(CS_URL + ticker, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    table = RE_TABLE.sub(r"\1", html).replace("\r", "").replace("\n", "")
    price = RE_PRICE.sub(r"\1", table)
    change = RE_CHANGE.sub(r"\1", table)
    if re.match(r"^[0-9.]+$", price):
        return {"price": float(price), "change": float(change) if re.match(r"^[+-]?[0-9.]+$", change) else 0}
    return None


def fetch_ticker(ticker):
    for fn in (fetch_nyse, fetch_schwab):
        try:
            result = fn(ticker)
            if result:
                return result
        except Exception:
            pass
    return None


def main():
    tickers = sys.argv[1:]
    if not tickers:
        print("Usage: fetch_stocks.py TICKER1 TICKER2 ...", file=sys.stderr)
        sys.exit(1)

    results = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(fetch_ticker, t): t for t in tickers}
        for future in futures:
            ticker = futures[future]
            try:
                data = future.result()
                if data:
                    results[ticker] = data
            except Exception:
                pass

    print(json.dumps({"data": results}))


if __name__ == "__main__":
    main()
