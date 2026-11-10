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
      _sortKey: { type: String },
      _sortDir: { type: String },
      _computed: { type: Array },
      _layout: { type: Number },
    };
  }

  constructor() {
    super();
    this._layout = LAYOUT_SM;
    this._sortKey = "value";
    this._sortDir = "desc";
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
    if (config.groups) {
      if (!config.groups.length || config.groups.some((g) => !g.portfolios?.length))
        throw new Error("each group needs portfolios");
    } else if (!config.portfolios || !config.portfolios.length) {
      throw new Error("portfolios or groups is required");
    }
    this._config = config;
    this._grouped = !!config.groups;
    this._groups = config.groups || [{ name: null, portfolios: config.portfolios }];
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
    this._computed = this._groups.map((group) => {
      const portfolios = group.portfolios.map((p) => this._computePortfolio(p, prices));
      return { name: group.name, portfolios, ...this._rollup(portfolios) };
    });
  }

  _rollup(items) {
    const totalValue = items.reduce((a, p) => a + p.totalValue, 0);
    const totalBasis = items.reduce((a, p) => a + p.totalBasis, 0);
    const totalGain = totalValue - totalBasis;
    return {
      totalValue,
      totalBasis,
      totalGain,
      totalGainPct: totalBasis ? (totalGain / totalBasis) * 100 : 0,
      totalChange: items.reduce((a, p) => a + p.totalChange, 0),
    };
  }

  _computePortfolio(portfolio, prices) {
    if (portfolio.categories) {
      const categories = portfolio.categories.map((c) => ({
        name: c.name,
        ...this._computeStocks(c.stocks, prices),
      }));
      return {
        name: portfolio.name,
        categories,
        stocks: categories.flatMap((c) => c.stocks),
        ...this._rollup(categories),
      };
    }
    return { name: portfolio.name, ...this._computeStocks(portfolio.stocks, prices) };
  }

  _computeStocks(list, prices) {
    const stocks = list.map((s) => {
      if (s.ticker === "CASH") {
        const value = s.shares;
        const basis = s.basis || value;
        const gain = value - basis;
        return {
          ticker: "CASH",
          shares: s.shares,
          basis,
          price: 1,
          value,
          gain,
          gainPct: basis ? (gain / basis) * 100 : 0,
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
      stocks,
      totalValue,
      totalBasis,
      totalGain,
      totalGainPct: totalBasis ? (totalGain / totalBasis) * 100 : 0,
      totalChange,
    };
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
    const th = (key, label, align = "right") => {
      const active = this._sortKey === key;
      const arrow = active
        ? html` <span class="sort-arrow">${this._sortDir === "asc" ? "▲" : "▼"}</span>`
        : "";
      return html`<td
        class="${align} col-header sortable ${active ? "sorted" : ""}"
        @click=${() => this._setSort(key)}
      >${label}${arrow}</td>`;
    };
    return html`
      <tr class="col-header-row">
        ${th("ticker", "Stock", "left")}
        ${th("price", "Price")}
        ${L >= LAYOUT_MD ? th("priceChange", "Change") : ""}
        ${L >= LAYOUT_LG ? th("shares", "Qty") : ""}
        ${L >= LAYOUT_MD ? th("basis", "Basis") : ""}
        ${th("gain", "Gain/Loss")}
        ${L >= LAYOUT_LG ? th("gainPct", "Gain%") : ""}
        ${th("value", "Value")}
      </tr>
    `;
  }

  _setSort(key) {
    if (this._sortKey === key) {
      this._sortDir = this._sortDir === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortDir = key === "ticker" ? "asc" : "desc";
    }
  }

  _sorted(stocks) {
    const key = this._sortKey;
    const dir = this._sortDir === "asc" ? 1 : -1;
    return [...stocks].sort((a, b) =>
      key === "ticker"
        ? dir * a.ticker.localeCompare(b.ticker)
        : dir * (a[key] - b[key])
    );
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

    const title = this._config.title || "Stock Portfolio";

    if (!this._grouped) {
      const group = this._computed[0];
      return html`
        <ha-card header="${title}">
          <div class="card-content">
            ${this._renderSummary(group)}
            ${this._renderHistoryToggle()}
            ${this._renderTable(group)}
          </div>
        </ha-card>
      `;
    }

    const overall = this._rollup(this._computed);
    return html`
      <ha-card>
        <div class="top-header ${this._layout === LAYOUT_SM ? "narrow" : ""}">
          <span class="header-title">${title}</span>
          <div class="header-total">
            <div class="header-title">$${this._fmt(overall.totalValue)}</div>
            <div class="summary-detail">
              <span class="${overall.totalGain >= 0 ? "gain" : "loss"}">
                ${this._fmtGain(overall.totalGain)} (${this._fmtPct(overall.totalGainPct)})
              </span>
              <span class="${overall.totalChange >= 0 ? "gain" : "loss"}">
                Day: ${this._fmtGain(overall.totalChange)}
              </span>
            </div>
          </div>
        </div>
        <div class="card-content">
          ${this._renderHistoryToggle()}
          ${this._computed.map(
            (group) => html`
              <div class="group ${this._layout === LAYOUT_SM ? "narrow" : ""}">
                ${group.name ? html`<div class="group-title">${group.name}</div>` : ""}
                ${this._renderSummary(group)}
                ${this._renderTable(group)}
              </div>
            `
          )}
        </div>
      </ha-card>
    `;
  }

  _renderSummary(t) {
    return html`
      <div class="summary">
        <div class="summary-value">$${this._fmt(t.totalValue)}</div>
        <div class="summary-detail">
          <span class="${t.totalGain >= 0 ? "gain" : "loss"}">
            ${this._fmtGain(t.totalGain)} (${this._fmtPct(t.totalGainPct)})
          </span>
          <span class="${t.totalChange >= 0 ? "gain" : "loss"}">
            Day: ${this._fmtGain(t.totalChange)}
          </span>
        </div>
      </div>
    `;
  }

  _renderHistoryToggle() {
    const historyDays = this._historyDays();
    if (!historyDays.length) return "";
    return html`
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
    `;
  }

  _renderStats(t, cls) {
    return html`
      <div class="section-header-grid ${cls} ${this._layout < LAYOUT_LG ? "narrow" : ""}">
        <span class="section-name">${t.name}</span>
        <span class="section-stats">
          <span class="section-stat ${t.totalGain >= 0 ? "gain" : "loss"}">
            ${this._fmtGain(t.totalGain)} (${this._fmtPct(t.totalGainPct)})
          </span>
          <span class="section-stat ${t.totalChange >= 0 ? "gain" : "loss"}">
            Day: ${this._fmtGain(t.totalChange)}
          </span>
        </span>
        <span class="section-total right">$${this._fmt(t.totalValue)}</span>
      </div>
    `;
  }

  _renderTable(group) {
    const cols = this._colCount();
    return html`
      <table>
        ${group.portfolios.map(
          (portfolio) => html`
            <tbody class="section">
              <tr class="section-header">
                ${group.portfolios.length === 1
                  ? html`<td class="section-name" colspan="${cols}">
                      ${portfolio.name}
                    </td>`
                  : html`<td colspan="${cols}">${this._renderStats(portfolio, "")}</td>`}
              </tr>
              ${this._renderHeader()}
              ${portfolio.categories
                ? portfolio.categories.map(
                    (c) => html`
                      <tr class="category-header">
                        <td colspan="${cols}">${this._renderStats(c, "category")}</td>
                      </tr>
                      ${this._sorted(c.stocks).map((s) => this._renderRow(s))}
                    `
                  )
                : this._sorted(portfolio.stocks).map((s) => this._renderRow(s))}
            </tbody>
          `
        )}
      </table>
    `;
  }

  static get styles() {
    return css`
      :host {
        --table-gain: #4caf50;
        --table-loss: #f44336;
        font-size: 1.1em;
      }
      .card-content {
        padding: 0 16px 16px;
      }
      .top-header {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0 16px;
        padding: 24px 16px 16px;
      }
      .header-title {
        font-size: var(--ha-card-header-font-size, 24px);
        color: var(--ha-card-header-color, var(--primary-text-color));
        line-height: 1.6;
      }
      .header-total {
        margin-left: auto;
        text-align: right;
        user-select: text;
      }
      .header-total .summary-detail {
        justify-content: flex-end;
      }
      .group {
        border: 1px solid var(--divider-color, #ddd);
        border-radius: var(--ha-card-border-radius, 12px);
        padding: 12px;
      }
      .group.narrow {
        padding: 8px 4px;
      }
      .top-header.narrow {
        flex-direction: column;
        align-items: center;
      }
      .top-header.narrow .header-total {
        margin-left: 0;
        text-align: center;
      }
      .top-header.narrow .summary-detail {
        justify-content: center;
      }
      .group.narrow .summary-value {
        font-size: var(--ha-card-header-font-size, 24px);
      }
      .group + .group {
        margin-top: 16px;
      }
      .group-title {
        font-size: var(--ha-card-header-font-size, 24px);
        color: var(--ha-card-header-color, var(--primary-text-color));
        line-height: 1.6;
        margin-bottom: 8px;
      }
      .summary {
        user-select: text;
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
        user-select: text;
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
      .section-stat {
        font-weight: normal;
        /* table is 0.9em; compensate to an effective 0.95em matching .summary-detail */
        font-size: calc(0.95em / 0.9);
        margin-right: 10px;
      }
      .section-header-grid {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        grid-template-areas: "name stats total";
        align-items: baseline;
      }
      .section-header-grid .section-name {
        grid-area: name;
      }
      .section-header-grid .section-stats {
        grid-area: stats;
        white-space: nowrap;
      }
      .section-header-grid .section-total {
        grid-area: total;
      }
      .category-header td {
        padding-top: 12px;
      }
      .section-header-grid.category .section-name,
      .section-header-grid.category .section-total {
        font-size: 1em;
        font-weight: 600;
        color: var(--secondary-text-color, #888);
      }
      .section-header-grid.narrow {
        grid-template-columns: 1fr auto;
        grid-template-areas:
          "name total"
          "stats stats";
      }
      .section-header-grid.narrow .section-stats {
        justify-self: center;
      }
      .col-header {
        font-weight: normal;
        color: var(--secondary-text-color, #888);
        font-size: 0.85em;
        padding: 4px 4px 6px;
        border-bottom: 1px solid var(--divider-color, #ddd);
      }
      .col-header.sortable {
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }
      .sort-arrow {
        font-size: 0.85em;
      }
      .col-header.sortable:hover,
      .col-header.sorted {
        color: var(--primary-text-color, #333);
      }
      tbody td {
        padding: 5px 4px;
        border-bottom: 1px solid
          color-mix(in srgb, var(--divider-color, #ddd) 50%, transparent);
      }
      .section:last-child tr:last-child td {
        border-bottom: none;
      }
      tbody tr:not([class]):hover {
        background-color: #333;
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
    const stockCount = this._groups
      .flatMap((g) => g.portfolios)
      .flatMap((p) => p.stocks || p.categories.flatMap((c) => c.stocks))
      .length;
    return 3 + stockCount;
  }
}

if (!customElements.get("stock-portfolio-table")) {
  customElements.define("stock-portfolio-table", StockPortfolioTable);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "stock-portfolio-table",
    name: "Stock Portfolio Table",
    description: "Responsive table showing stock portfolio with adaptive columns",
  });
}
