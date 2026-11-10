#!/usr/bin/env python3
"""Fetch stock prices from NYSE API with Schwab HTML fallback."""

import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

NYSE_URL = "https://www.nyse.com/api/nyseservice/v1/quotes?symbol="
CS_URL = "https://www.schwab.wallst.com/Prospect/Research/mutualfunds/fees.asp?symbol="
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"

RE_TABLE = re.compile(r"^[\s\S]*(<table id=\"firstGlanceQuoteTable\".*?</table>)[\s\S]*$", re.DOTALL)
RE_PRICE = re.compile(r"^.*?<tbody><tr><td>\$([0-9,.]+)</td>.*$")
RE_CHANGE = re.compile(r"^.*?<tbody><tr><td>\$[0-9,.]+</td><td><span.*?>([+-]?[0-9,.]+)</span>.*$")


def fetch_nyse(ticker):
    req = urllib.request.Request(
        NYSE_URL + ticker.replace("/", "."),
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    price = data.get("quote", {}).get("last")
    change = data.get("quote", {}).get("change")
    volume = data.get("quote", {}).get("volume")
    if price is not None and re.match(r"^[0-9.]+$", str(price)) and float(price) > 0:
        result = {"price": float(price), "change": float(change or 0)}
        # After ~7 PM ET NYSE rolls the quote over (change and volume reset to 0) until the
        # next open: take the session's real change from Schwab/Yahoo, else keep this quote
        if result["change"] == 0 and float(volume or 0) == 0:
            return fetch_ticker(ticker, (fetch_schwab, fetch_yahoo)) or result
        return result
    return None


def fetch_schwab(ticker):
    req = urllib.request.Request(CS_URL + ticker.replace(".", "/"), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        html = resp.read().decode("utf-8", errors="replace")
    table = RE_TABLE.sub(r"\1", html).replace("\r", "").replace("\n", "")
    price = RE_PRICE.sub(r"\1", table).replace(",", "")
    change = RE_CHANGE.sub(r"\1", table).replace(",", "")
    if re.match(r"^[0-9.]+$", price):
        return {"price": float(price), "change": float(change) if re.match(r"^[+-]?[0-9.]+$", change) else 0}
    return None


def fetch_yahoo(ticker):
    req = urllib.request.Request(
        YAHOO_URL + urllib.parse.quote(ticker) + "?range=1d&interval=1d",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read())
    meta = (data.get("chart", {}).get("result") or [{}])[0].get("meta", {})
    price = meta.get("regularMarketPrice")
    prev_close = meta.get("chartPreviousClose")
    if price and price > 0:
        return {"price": float(price), "change": round(price - prev_close, 2) if prev_close else 0}
    return None


def nyse_alive():
    """Probe NYSE once; if it's down/hanging, skip it for the whole run
    so 33 tickers don't each burn a 10s timeout before falling back."""
    req = urllib.request.Request(
        NYSE_URL + "SPY",
        headers={
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            resp.read()
        return True
    except Exception:
        return False


def fetch_ticker(ticker, sources):
    for fn in sources:
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

    sources = ((fetch_nyse, fetch_schwab) if nyse_alive() else (fetch_schwab,)) + (fetch_yahoo,)

    # NYSE mismatches "=" tickers (CL=F returns Colgate), so futures go straight to Yahoo
    results = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(fetch_ticker, t, (fetch_yahoo,) if "=" in t else sources): t for t in tickers}
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
