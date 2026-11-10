#!/usr/bin/env node

const tickers = process.argv.slice(2);
if (!tickers.length) {
  console.error("Usage: fetch_stocks.js TICKER1 TICKER2 ...");
  process.exit(1);
}

const nyseURL = "https://www.nyse.com/api/nyseservice/v1/quotes?symbol=";
const csURL = "https://www.schwab.wallst.com/Prospect/Research/mutualfunds/fees.asp?symbol=";
const yahooURL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const reTABLE = /^[\s\S]*(<table id="firstGlanceQuoteTable".*?<\/table>)[\s\S]*$/m;
const rePRICE = /^.*?<tbody><tr><td>\$([0-9,\.]+)<\/td>.*$/;
const reCHANGE = /^.*?<tbody><tr><td>\$[0-9,\.]+<\/td><td><span.*?>([+-]?[0-9,\.]+)<\/span>.*$/;

function nyseRequest(ticker, timeout) {
  return fetch(nyseURL + ticker.replace("/", "."), {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "max-age=0",
      "sec-ch-ua": "\"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"macOS\"",
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1"
    },
    signal: AbortSignal.timeout(timeout),
  });
}

async function fetchNyse(ticker) {
  const response = await nyseRequest(ticker, 10000);
  const nyse = await response.json();
  const price = nyse?.quote?.last;
  const change = nyse?.quote?.change;
  if (/^[0-9.]+$/.test(String(price)) && parseFloat(price) > 0) {
    const result = { price: parseFloat(price), change: parseFloat(change) || 0 };
    // After ~7 PM ET NYSE rolls the quote over (change and volume reset to 0) until the
    // next open: take the session's real change from Schwab/Yahoo, else keep this quote
    if (result.change === 0 && Number(nyse.quote.volume || 0) === 0) {
      return await fetchTicker(ticker, [fetchSchwab, fetchYahoo]) || result;
    }
    return result;
  }
  return null;
}

async function fetchSchwab(ticker) {
  const response = await fetch(csURL + ticker.replace(".", "/"), { signal: AbortSignal.timeout(10000) });
  const html = await response.text();
  const table = html.replace(reTABLE, "$1").replace(/[\r\n]/g, "");
  const price = table.replace(rePRICE, "$1").replace(/,/g, "");
  const change = table.replace(reCHANGE, "$1").replace(/,/g, "");
  if (/^[0-9.]+$/.test(price)) {
    return { price: parseFloat(price), change: parseFloat(change) || 0 };
  }
  return null;
}

async function fetchYahoo(ticker) {
  const response = await fetch(yahooURL + encodeURIComponent(ticker) + "?range=1d&interval=1d", {
    headers: { "user-agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(10000),
  });
  const yahoo = await response.json();
  const meta = yahoo?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const prevClose = meta?.chartPreviousClose;
  if (price > 0) {
    return { price, change: prevClose ? Math.round((price - prevClose) * 100) / 100 : 0 };
  }
  return null;
}

// Probe NYSE once; if it's down/hanging, skip it for the whole run
// so every ticker doesn't burn a 10s timeout before falling back
async function nyseAlive() {
  try {
    const response = await nyseRequest("SPY", 3000);
    await response.text();
    return response.ok;
  } catch (e) {
    return false;
  }
}

async function fetchTicker(ticker, sources) {
  for (const fn of sources) {
    try {
      const result = await fn(ticker);
      if (result) return result;
    } catch (e) { /* fall through */ }
  }
  return null;
}

async function main() {
  const sources = [...(await nyseAlive() ? [fetchNyse, fetchSchwab] : [fetchSchwab]), fetchYahoo];

  // NYSE mismatches "=" tickers (CL=F returns Colgate), so futures go straight to Yahoo
  const results = {};
  const promises = tickers.map(async (ticker) => {
    const data = await fetchTicker(ticker, ticker.includes("=") ? [fetchYahoo] : sources);
    if (data) results[ticker] = data;
  });
  await Promise.all(promises);
  console.log(JSON.stringify({ data: results }));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
