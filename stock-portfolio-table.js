const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace") || customElements.get("hc-lovelace")
);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

const STORAGE_KEY = "stock-portfolio-card-history";
const LAYOUT_SM = 0;  // 12 (~375px)
const LAYOUT_MD = 1;  // 24 (~750px)
const LAYOUT_LG = 2;  // 36 (~1125px)
const LAYOUT_XL = 3;  // 48 (~1500px)

class StockPortfolioTable extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      _hass: { type: Object },
      _selectedDay: { type: String },
      _computed: { type: Array },
      _layout: { type: Number },
    };
  }

  constructor() {
    super();
    this._layout = LAYOUT_SM;
    this._ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || this.getBoundingClientRect().width || 0;
      if (w === 0) return;
      const layout = w >= 900 ? LAYOUT_XL : w >= 600 ? LAYOUT_LG : w >= 400 ? LAYOUT_MD : LAYOUT_SM;
      if (layout !== this._layout) {
        this._layout = layout;
        this.requestUpdate();
      }
    });
  }

  firstUpdated() {
    this._ro.observe(this);
    this._onResize = () => {
      setTimeout(() => {
        this._checkWidth();
        this.requestUpdate();
      }, 100);
    };
    window.addEventListener("resize", this._onResize);
    screen.orientation?.addEventListener("change", this._onResize);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._ro.disconnect();
    window.removeEventListener("resize", this._onResize);
    screen.orientation?.removeEventListener("change", this._onResize);
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
    this._checkWidth();
    this._storeDailySnapshot();
    this._recompute();
  }

  _checkWidth() {
    const w = this.getBoundingClientRect().width || 0;
    if (w === 0) return;
    const layout = w >= 900 ? LAYOUT_XL : w >= 600 ? LAYOUT_LG : w >= 400 ? LAYOUT_MD : LAYOUT_SM;
    if (layout !== this._layout) {
      this._layout = layout;
    }
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
            priceChange: 0,
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
          priceChange: change,
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
    return Object.keys(history)
      .filter((d) => d !== today)
      .sort()
      .reverse()
      .slice(0, 6);
  }

  _dayLabel(dateStr) {
    const d = new Date(dateStr + "T12:00:00");
    const diffDays = Math.round((new Date() - d) / 86400000);
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

  _renderHeader() {
    const L = this._layout;
    return html`
      <tr class="col-header-row">
        <td class="left col-header">Stock</td>
        <td class="right col-header">Price</td>
        ${L >= LAYOUT_MD ? html`<td class="right col-header">Change</td>` : ""}
        ${L >= LAYOUT_LG ? html`<td class="right col-header">Qty</td>` : ""}
        ${L >= LAYOUT_MD ? html`<td class="right col-header">Basis</td>` : ""}
        <td class="right col-header">Gain/Loss</td>
        ${L >= LAYOUT_LG ? html`<td class="right col-header">Gain%</td>` : ""}
        <td class="right col-header">Value</td>
      </tr>
    `;
  }

  _renderRow(s) {
    const L = this._layout;
    const gc = s.gain >= 0 ? "gain" : "loss";
    return html`
      <tr>
        <td class="left ticker">${s.ticker}</td>
        <td class="right">$${this._fmt(s.price)}</td>
        ${L >= LAYOUT_MD
          ? html`<td class="right ${s.priceChange >= 0 ? "gain" : "loss"}">
              ${s.priceChange >= 0 ? "+$" : "-$"}${this._fmt(Math.abs(s.priceChange))}
            </td>`
          : ""}
        ${L >= LAYOUT_LG ? html`<td class="right">${s.shares.toFixed(2)}</td>` : ""}
        ${L >= LAYOUT_MD ? html`<td class="right">$${this._fmt(s.basis)}</td>` : ""}
        <td class="right ${gc}">${this._fmtGain(s.gain)}</td>
        ${L >= LAYOUT_LG ? html`<td class="right ${gc}">${this._fmtPct(s.gainPct)}</td>` : ""}
        <td class="right">$${this._fmt(s.value)}</td>
      </tr>
    `;
  }

  _colCount() {
    return this._layout >= LAYOUT_LG ? 8 : this._layout === LAYOUT_MD ? 6 : 4;
  }

  render() {
    if (!this._config || !this._hass) return html``;
    this._checkWidth();
    if (!this._computed) this._recompute();

    const overallValue = this._computed.reduce((a, p) => a + p.totalValue, 0);
    const overallBasis = this._computed.reduce((a, p) => a + p.totalBasis, 0);
    const overallGain = overallValue - overallBasis;
    const overallGainPct = overallBasis ? (overallGain / overallBasis) * 100 : 0;
    const overallChange = this._computed.reduce((a, p) => a + p.totalChange, 0);
    const historyDays = this._historyDays();
    const cols = this._colCount();

    return html`
      <ha-card header="${this._config.title || "Stock Portfolio"}">
        <div class="card-content">
          <div class="summary">
            <div class="summary-value">$${this._fmt(overallValue)}</div>
            <div class="summary-detail">
              <span class="${overallGain >= 0 ? "gain" : "loss"}">
                ${this._fmtGain(overallGain)} (${this._fmtPct(overallGainPct)})
              </span>
              <span class="${overallChange >= 0 ? "gain" : "loss"}">
                Day: ${this._fmtGain(overallChange)}
              </span>
            </div>
          </div>

          ${historyDays.length
            ? html`
                <div class="history-toggle">
                  <button
                    class="${this._selectedDay === "today" ? "active" : ""}"
                    @click=${() => this._selectDay("today")}
                  >Today</button>
                  ${historyDays.map(
                    (d) => html`
                      <button
                        class="${this._selectedDay === d ? "active" : ""}"
                        @click=${() => this._selectDay(d)}
                      >${this._dayLabel(d)}</button>
                    `
                  )}
                </div>
              `
            : ""}

          <table>
            ${this._computed.map(
              (portfolio) => html`
                <tbody class="section">
                  <tr class="section-header">
                    <td class="section-name" colspan="${Math.ceil(cols / 2)}">
                      ${portfolio.name}
                    </td>
                    <td class="section-total right" colspan="${Math.floor(cols / 2)}">
                      $${this._fmt(portfolio.totalValue)}
                    </td>
                  </tr>
                  ${this._renderHeader()}
                  ${portfolio.stocks.map((s) => this._renderRow(s))}
                </tbody>
              `
            )}
          </table>
        </div>
      </ha-card>
    `;
  }

  static get styles() {
    return css`
      :host {
        --table-gain: #4caf50;
        --table-loss: #f44336;
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
        color: var(--table-gain);
      }
      .loss {
        color: var(--table-loss);
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
      .section + .section .section-header td {
        padding-top: 16px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9em;
      }
      .section-header {
        border-bottom: 1px solid var(--divider-color, #ddd);
      }
      .section-name {
        font-weight: bold;
        font-size: 1.1em;
        padding: 6px 0;
      }
      .section-total {
        font-weight: bold;
        font-size: 1.1em;
        padding: 6px 0;
        white-space: nowrap;
      }
      .col-header {
        font-weight: normal;
        color: var(--secondary-text-color, #888);
        font-size: 0.85em;
        padding: 4px 4px 6px;
        border-bottom: 1px solid var(--divider-color, #ddd);
      }
      tbody td {
        padding: 5px 4px;
        border-bottom: 1px solid
          color-mix(in srgb, var(--divider-color, #ddd) 50%, transparent);
      }
      .left {
        text-align: left;
      }
      .right {
        text-align: right;
      }
      .ticker {
        font-weight: bold;
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

customElements.define("stock-portfolio-table", StockPortfolioTable);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "stock-portfolio-table",
  name: "Stock Portfolio Table",
  description: "Responsive table showing stock portfolio with adaptive columns",
});
