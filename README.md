# Stock Portfolio Card

Home Assistant custom cards for tracking a stock portfolio across one or more brokerages.

- **`stock-portfolio-table`** (main card) — responsive table with per-stock price, change, basis, gain/loss and value, grouped by brokerage.
- **`stock-portfolio-card`** — horizontal bar chart showing basis (gray) + gain (green) or loss (red) per stock.

## Features

- Overall value, gain/loss and day change summary at the top
- Portfolios rendered as sections, each with its own gain, day change and value
- Optional **groups** to stack several tables in one card, with the grand total in the top right
- Adaptive columns based on card width:

  | Width | Columns |
  |---|---|
  | < 400px | Stock, Price, Gain/Loss, Value |
  | 400–599px | + Change, Basis |
  | ≥ 600px | + Qty, Gain% |

- History toggle — daily price snapshots (last 14 days) stored in browser localStorage
- `CASH` pseudo-ticker: `shares` is the dollar amount; optional `basis` (0 or omitted = no gain)
- Dark/light theme support via HA CSS variables

## Installation

Copy `stock-portfolio-table.js` (and/or `stock-portfolio-card.js`) to `/config/www/` and add as resources:

```yaml
resources:
  - url: /local/stock-portfolio-table.js
    type: module
  - url: /local/stock-portfolio-card.js
    type: module
```

Note: the HACS manifest (`hacs.json`) currently only installs `stock-portfolio-card.js`.

## Sensor Setup

Copy `scripts/fetch_stocks.py` to `/config/scripts/` and add to `configuration.yaml`:

```yaml
command_line:
  - sensor:
      name: "Stock Prices"
      unique_id: stock_prices_all
      command: "python3 /config/scripts/fetch_stocks.py TSLA AMZN GOOG"
      scan_interval: 1800
      command_timeout: 60
      value_template: "{{ value_json.data | length }} stocks"
      json_attributes:
        - data
```

Every ticker used in a card must be listed in the command. `scripts/fetch_stocks.js` is an equivalent Node version (Node 18+); the Home Assistant container does not include Node, so use the Python script there.

How the script gets quotes:

- Each ticker is tried against the NYSE API, then Schwab, then Yahoo; the first source that returns a price is used. Schwab covers mutual funds, which NYSE does not quote.
- NYSE is probed once per run and skipped if it is down, so a hung NYSE doesn't cost a timeout per ticker.
- After about 7 PM ET the NYSE API resets the day's change and volume to zero until the next open. In that state the change is taken from Schwab or Yahoo, so evenings and weekends show the last session's change.
- Tickers containing `=` (futures such as `CL=F`) go straight to Yahoo.
- Class shares can be written `BRK/B` or `BRK.B`; use the same form in the card.
- Prices are regular-session prices; after-hours trades are not included.

## Table Card Configuration

### Simple — one list of portfolios

```yaml
type: custom:stock-portfolio-table
title: Stock Portfolio
entity: sensor.stock_prices
grid_options:
  columns: 48
  rows: auto
portfolios:
  - name: Charles Schwab
    stocks:
      - ticker: TSLA
        shares: 29
        basis: 5224.75
      - ticker: CASH
        shares: 5.19
  - name: Fidelity
    stocks:
      - ticker: WMT
        shares: 100
        basis: 9000
```

### Grouped — several sets of portfolios in one card

Use `groups` instead of `portfolios`. Each group renders exactly like a standalone table (its name as a title — omit `name` for no title — its own summary and sections), stacked in one card. The card header shows the title on the left and the grand total across all groups on the right.

```yaml
type: custom:stock-portfolio-table
title: Total Portfolio
entity: sensor.stock_prices
groups:
  - name: Stock Portfolio
    portfolios:
      - name: Charles Schwab
        stocks:
          - ticker: TSLA
            shares: 29
            basis: 5224.75
      - name: Fidelity
        stocks:
          - ticker: WMT
            shares: 100
            basis: 9000
  - name: Merrill Lynch
    portfolios:
      - name: Merrill Lynch
        stocks:
          - ticker: NVDA
            shares: 183
            basis: 32896.44
```

### Categories — sub-sections inside a portfolio

Use `categories` instead of `stocks` to split a portfolio the way a brokerage does (Equities, ETFs, Mutual Funds, Cash). The portfolio header keeps its total; each category gets a smaller sub-header with its own subtotal. Rows are sorted within each category.

```yaml
portfolios:
  - name: Charles Schwab
    categories:
      - name: Equities
        stocks:
          - ticker: TSLA
            shares: 29
            basis: 5224.75
      - name: ETFs & Closed End Funds
        stocks:
          - ticker: IXC
            shares: 93.6211
            basis: 2630.91
      - name: Cash & Money Market
        stocks:
          - ticker: CASH
            shares: 5.19
```

### Options

| Option | Required | Description |
|---|---|---|
| `entity` | yes | Sensor with a `data` attribute of `{TICKER: {price, change}}` |
| `title` | no | Card title (default `Stock Portfolio`) |
| `portfolios` | one of | List of `{name, stocks}` or `{name, categories}` |
| `groups` | one of | List of `{name, portfolios}` |
| `categories` | no | List of `{name, stocks}` inside a portfolio |
| `stocks[].ticker` | yes | Ticker symbol, or `CASH` |
| `stocks[].shares` | yes | Share count (dollar amount for `CASH`) |
| `stocks[].basis` | yes* | Total cost basis (*optional for `CASH`) |

## Bar Chart Card Configuration

```yaml
type: custom:stock-portfolio-card
entity: sensor.stock_prices
title: "Investment Portfolio"
portfolios:
  - name: "Charles Schwab"
    stocks:
      - ticker: TSLA
        shares: 29
        basis: 5224.75
```

## License

MIT
