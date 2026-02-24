#!/usr/bin/env node

const tickers = process.argv.slice(2);
if (!tickers.length) {
  console.error("Usage: fetch_stocks.js TICKER1 TICKER2 ...");
  process.exit(1);
}

const nyseURL = "https://www.nyse.com/api/nyseservice/v1/quotes?symbol=";
const csURL = "https://www.schwab.wallst.com/Prospect/Research/mutualfunds/fees.asp?symbol=";
const reTABLE = /^[\s\S]*(<table id="firstGlanceQuoteTable".*?<\/table>)[\s\S]*$/m;
const rePRICE = /^.*?<tbody><tr><td>\$([0-9\.]+)<\/td>.*$/;
const reCHANGE = /^.*?<tbody><tr><td>\$[0-9\.]+<\/td><td><span.*?>([+-]?[0-9\.]+)<\/span>.*$/;

async function fetchNyse(ticker) {
  const response = await fetch(nyseURL + ticker, {
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
  });
  const nyse = await response.json();
  const price = nyse?.quote?.last;
  const change = nyse?.quote?.change;
  if (/^[0-9.]+$/.test(String(price))) {
    return { price: parseFloat(price), change: parseFloat(change) || 0 };
  }
  return null;
}

async function fetchSchwab(ticker) {
  const response = await fetch(csURL + ticker);
  const html = await response.text();
  const table = html.replace(reTABLE, "$1").replace(/[\r\n]/g, "");
  const price = table.replace(rePRICE, "$1");
  const change = table.replace(reCHANGE, "$1");
  if (/^[0-9.]+$/.test(price)) {
    return { price: parseFloat(price), change: parseFloat(change) || 0 };
  }
  return null;
}

async function fetchTicker(ticker) {
  try {
    const result = await fetchNyse(ticker);
    if (result) return result;
  } catch (e) { /* fall through */ }
  try {
    const result = await fetchSchwab(ticker);
    if (result) return result;
  } catch (e) { /* fall through */ }
  return null;
}

async function main() {
  const results = {};
  const promises = tickers.map(async (ticker) => {
    const data = await fetchTicker(ticker);
    if (data) results[ticker] = data;
  });
  await Promise.all(promises);
  console.log(JSON.stringify({ data: results }));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
