const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace") || customElements.get("hc-lovelace")
);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

const STORAGE_KEY = "stock-portfolio-card-history";

class StockPortfolioCard extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      _hass: { type: Object },
      _selectedDay: { type: String },
      _computed: { type: Array },
    };
  }

  setConfig(config) {
    if (!config.entity) throw new Error("entity is required");
    if (!config.portfolios || !config.portfolios.length)
      throw new Error("portfolios is required");
    this._config = config;
    this._selectedDay = "today";
  }

  set hass(hass) {
    this._hass = hass;
    this._storeDailySnapshot();
    this._recompute();
  }

  _today() {
    return new Date().toISOString().slice(0, 10);
  }

  _getHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  _storeDailySnapshot() {
    const entity = this._hass.states[this._config.entity];
    if (!entity || !entity.attributes.data) return;
    const history = this._getHistory();
    const today = this._today();
    history[today] = {
      data: entity.attributes.data,
      ts: Date.now(),
    };
    // Keep only last 14 days
    const keys = Object.keys(history).sort().reverse();
    const pruned = {};
    keys.slice(0, 14).forEach((k) => (pruned[k] = history[k]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  }

  _getPrices() {
    if (this._selectedDay === "today") {
      const entity = this._hass.states[this._config.entity];
      return entity?.attributes?.data || {};
    }
    const history = this._getHistory();
    return history[this._selectedDay]?.data || {};
  }

  _recompute() {
    const prices = this._getPrices();
    this._computed = this._config.portfolios.map((portfolio) => {
      const stocks = portfolio.stocks.map((s) => {
        if (s.ticker === "CASH") {
          const value = s.shares;
          return {
            ticker: "CASH",
            shares: s.shares,
            basis: value,
            price: 1,
            value,
            gain: 0,
            gainPct: 0,
            change: 0,
          };
        }
        const p = prices[s.ticker];
        const price = p ? p.price : 0;
        const change = p ? p.change : 0;
        const value = price * s.shares;
        const gain = value - s.basis;
        const gainPct = s.basis ? (gain / s.basis) * 100 : 0;
        return {
          ticker: s.ticker,
          shares: s.shares,
          basis: s.basis,
          price,
          value,
          gain,
          gainPct,
          change: change * s.shares,
        };
      });
      const totalValue = stocks.reduce((a, s) => a + s.value, 0);
      const totalBasis = stocks.reduce((a, s) => a + s.basis, 0);
      const totalGain = totalValue - totalBasis;
      const totalChange = stocks.reduce((a, s) => a + s.change, 0);
      return {
        name: portfolio.name,
        stocks,
        totalValue,
        totalBasis,
        totalGain,
        totalGainPct: totalBasis ? (totalGain / totalBasis) * 100 : 0,
        totalChange,
      };
    });
  }

  _historyDays() {
    const history = this._getHistory();
    const today = this._today();
    const days = Object.keys(history)
      .filter((d) => d !== today)
      .sort()
      .reverse()
      .slice(0, 6);
    return days;
  }

  _dayLabel(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  _selectDay(day) {
    this._selectedDay = day;
    this._recompute();
  }

  _fmt(n) {
    return n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  _fmtPct(n) {
    return (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  }

  _fmtGain(n) {
    return (n >= 0 ? "+$" : "-$") + this._fmt(Math.abs(n));
  }

  render() {
    if (!this._config || !this._hass) return html``;
    if (!this._computed) this._recompute();
    const overallValue = this._computed.reduce((a, p) => a + p.totalValue, 0);
    const overallBasis = this._computed.reduce((a, p) => a + p.totalBasis, 0);
    const overallGain = overallValue - overallBasis;
    const overallGainPct = overallBasis ? (overallGain / overallBasis) * 100 : 0;
    const overallChange = this._computed.reduce((a, p) => a + p.totalChange, 0);

    const historyDays = this._historyDays();

    return html`
      <ha-card header="${this._config.title || "Stock Portfolio"}">
        <div class="card-content">
          <div class="summary">
            <div class="summary-value">$${this._fmt(overallValue)}</div>
            <div class="summary-detail">
              <span class="${overallGain >= 0 ? "gain" : "loss"}">
                ${this._fmtGain(overallGain)} (${this._fmtPct(overallGainPct)})
              </span>
              <span class="change ${overallChange >= 0 ? "gain" : "loss"}">
                Today: ${this._fmtGain(overallChange)}
              </span>
            </div>
          </div>

          ${historyDays.length
            ? html`
                <div class="history-toggle">
                  <button
                    class="${this._selectedDay === "today" ? "active" : ""}"
                    @click=${() => this._selectDay("today")}
                  >
                    Today
                  </button>
                  ${historyDays.map(
                    (d) => html`
                      <button
                        class="${this._selectedDay === d ? "active" : ""}"
                        @click=${() => this._selectDay(d)}
                      >
                        ${this._dayLabel(d)}
                      </button>
                    `
                  )}
                </div>
              `
            : ""}

          ${this._computed.map(
            (portfolio) => html`
              <div class="section">
                <div class="section-header">
                  <span class="section-name">${portfolio.name}</span>
                  <span class="section-total">
                    $${this._fmt(portfolio.totalValue)}
                    <span class="${portfolio.totalGain >= 0 ? "gain" : "loss"}">
                      ${this._fmtGain(portfolio.totalGain)}
                    </span>
                  </span>
                </div>
                <div class="chart">
                  ${(() => {
                    const maxVal = Math.max(...portfolio.stocks.map((s) => Math.max(s.value, s.basis)), 1);
                    return portfolio.stocks.map((stock) => {
                    const basisPct = (stock.basis / maxVal) * 100;
                    const valuePct = (stock.value / maxVal) * 100;
                    const basisWidth = stock.gain >= 0 ? basisPct : valuePct;
                    const gainWidth = stock.gain > 0 ? valuePct - basisPct : 0;
                    const lossWidth = stock.gain < 0 ? basisPct - valuePct : 0;
                    return html`
                      <div class="bar-row">
                        <div class="bar-label">
                          <span class="ticker">${stock.ticker}</span>
                          <span class="bar-value">$${this._fmt(stock.value)}</span>
                        </div>
                        <div class="bar-container">
                          ${stock.gain >= 0
                            ? html`
                                <div
                                  class="bar basis"
                                  style="width:${basisWidth}%"
                                ></div>
                                <div
                                  class="bar gain-bar"
                                  style="width:${gainWidth}%"
                                ></div>
                              `
                            : html`
                                <div
                                  class="bar basis"
                                  style="width:${basisWidth}%"
                                ></div>
                                <div
                                  class="bar loss-bar"
                                  style="width:${lossWidth}%"
                                ></div>
                              `}
                        </div>
                        <div
                          class="bar-gain ${stock.gain >= 0 ? "gain" : "loss"}"
                        >
                          ${this._fmtGain(stock.gain)}
                          (${this._fmtPct(stock.gainPct)})
                        </div>
                      </div>
                    `;
                  })})()}
                </div>
              </div>
            `
          )}
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host {
        --bar-basis: var(--secondary-text-color, #888);
        --bar-gain: #4caf50;
        --bar-loss: #f44336;
      }
      .card-content {
        padding: 0 16px 16px;
      }
      .summary {
        text-align: center;
        margin-bottom: 12px;
      }
      .summary-value {
        font-size: 1.8em;
        font-weight: bold;
      }
      .summary-detail {
        display: flex;
        justify-content: center;
        gap: 16px;
        font-size: 0.95em;
      }
      .gain {
        color: var(--bar-gain);
      }
      .loss {
        color: var(--bar-loss);
      }
      .history-toggle {
        display: flex;
        gap: 4px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .history-toggle button {
        background: var(--primary-background-color, #fff);
        color: var(--primary-text-color, #333);
        border: 1px solid var(--divider-color, #ddd);
        border-radius: 12px;
        padding: 4px 10px;
        font-size: 0.8em;
        cursor: pointer;
      }
      .history-toggle button.active {
        background: var(--primary-color, #03a9f4);
        color: #fff;
        border-color: var(--primary-color, #03a9f4);
      }
      .section {
        margin-top: 12px;
      }
      .section-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--divider-color, #ddd);
      }
      .section-name {
        font-weight: bold;
        font-size: 1em;
      }
      .section-total {
        font-size: 0.9em;
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .chart {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .bar-row {
        display: grid;
        grid-template-columns: 100px 1fr 120px;
        align-items: center;
        gap: 8px;
      }
      .bar-label {
        display: flex;
        flex-direction: column;
      }
      .ticker {
        font-weight: bold;
        font-size: 0.9em;
      }
      .bar-value {
        font-size: 0.8em;
        color: var(--secondary-text-color, #888);
      }
      .bar-container {
        display: flex;
        height: 18px;
        border-radius: 3px;
        overflow: hidden;
        position: relative;
      }
      .bar {
        height: 100%;
      }
      .bar.basis {
        background: var(--bar-basis);
        opacity: 0.4;
      }
      .bar.gain-bar {
        background: var(--bar-gain);
      }
      .bar.loss-bar {
        background: var(--bar-loss);
        opacity: 0.6;
      }
      .bar-gain {
        font-size: 0.8em;
        text-align: right;
        white-space: nowrap;
      }
    `;
  }

  getCardSize() {
    const stockCount = this._config.portfolios.reduce(
      (a, p) => a + p.stocks.length,
      0
    );
    return 3 + stockCount;
  }
}

customElements.define("stock-portfolio-card", StockPortfolioCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "stock-portfolio-card",
  name: "Stock Portfolio Card",
  description: "Bar chart showing stock portfolio basis, gain/loss, and value",
});
