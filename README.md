# Stock Portfolio Card

A Home Assistant custom card that displays your stock portfolio as a horizontal bar chart — showing basis, gain/loss, and current value per stock.

## Features

- Horizontal bar chart grouped by portfolio/brokerage
- Bars show cost basis (gray) + gain (green) or loss (red)
- Overall portfolio summary with total value and daily change
- History toggle — snapshots stored in browser localStorage
- Dark/light theme support via HA CSS variables

## Installation

### HACS (Recommended)

1. Open HACS in Home Assistant
2. Go to **Frontend** → **+** → **Custom repositories**
3. Add this repo URL, category: **Lovelace**
4. Install **Stock Portfolio Card**

### Manual

Copy `stock-portfolio-card.js` to your `/config/www/` directory and add as a resource:

```yaml
resources:
  - url: /local/stock-portfolio-card.js
    type: module
```

## Sensor Setup

Copy `scripts/fetch_stocks.js` to `/config/scripts/` and add to `configuration.yaml`:

```yaml
command_line:
  - sensor:
      name: "Stock Prices"
      unique_id: stock_prices_all
      command: "node /config/scripts/fetch_stocks.js TSLA AMZN GOOG"
      scan_interval: 1800
      value_template: "{{ value_json.data | length }} stocks"
      json_attributes:
        - data
```

## Card Configuration

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
      - ticker: AMZN
        shares: 49
        basis: 4387.74
```

## License

MIT
