// ============================================================
// Ledger — client-only stock return tracker
// All data lives in localStorage. Prices/history come from
// Alpha Vantage (https://www.alphavantage.co), called directly
// from the browser with the user's own free API key.
// ============================================================

const STORAGE_KEYS = {
  txns: 'ledger_txns_v1',
  apiKey: 'H13TZWUUR3AO0ITX',
  priceCache: 'ledger_price_cache_v1',
};

// ---------- Storage helpers ----------

function loadTxns() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.txns)) || [];
  } catch { return []; }
}

function saveTxns(txns) {
  localStorage.setItem(STORAGE_KEYS.txns, JSON.stringify(txns));
}

function loadApiKey() {
  try { return localStorage.getItem(STORAGE_KEYS.apiKey) || 'H13TZWUUR3AO0ITX'; }
  catch { return ''; }
}

function saveApiKey(key) {
  localStorage.setItem(STORAGE_KEYS.apiKey, key);
}

function loadPriceCache() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.priceCache)) || {};
  } catch { return {}; }
}

function savePriceCache(cache) {
  localStorage.setItem(STORAGE_KEYS.priceCache, JSON.stringify(cache));
}

// ---------- Formatting ----------

const fmtUSD = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const fmtPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

const fmtNum = (n, dp = 4) =>
  Number(n).toLocaleString('en-US', { maximumFractionDigits: dp });

function daysBetween(dateStr, endDate = new Date()) {
  const start = new Date(dateStr + 'T00:00:00');
  const ms = endDate - start;
  return Math.max(1, Math.round(ms / 86400000));
}

// ---------- Core calculations ----------

function lotCostBasis(txn) {
  return txn.shares * txn.price + (txn.fees || 0);
}

function groupHoldings(txns, priceCache) {
  const groups = {};
  for (const t of txns) {
    const key = `${t.ticker}__${t.platform}`;
    if (!groups[key]) {
      groups[key] = { ticker: t.ticker, platform: t.platform, lots: [] };
    }
    groups[key].lots.push(t);
  }

  return Object.values(groups).map((g) => {
    const totalShares = g.lots.reduce((s, l) => s + Number(l.shares), 0);
    const totalCost = g.lots.reduce((s, l) => s + lotCostBasis(l), 0);
    const avgCost = totalCost / totalShares;

    // cost-weighted average holding period, for a single blended annualized return
    const weightedDays = g.lots.reduce(
      (s, l) => s + lotCostBasis(l) * daysBetween(l.date), 0
    ) / totalCost;

    const cached = priceCache[g.ticker];
    const currentPrice = cached ? cached.price : null;
    const marketValue = currentPrice != null ? currentPrice * totalShares : null;
    const gainAbs = marketValue != null ? marketValue - totalCost : null;
    const gainPct = marketValue != null ? (gainAbs / totalCost) * 100 : null;

    let annualized = null;
    if (marketValue != null && totalCost > 0 && marketValue > 0) {
      annualized = (Math.pow(marketValue / totalCost, 365 / weightedDays) - 1) * 100;
    }

    return {
      ticker: g.ticker,
      platform: g.platform,
      totalShares,
      totalCost,
      avgCost,
      currentPrice,
      marketValue,
      gainAbs,
      gainPct,
      annualized,
      priceAsOf: cached ? cached.asOf : null,
      lots: g.lots,
    };
  }).sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------- Alpha Vantage ----------

async function fetchQuote(ticker, apiKey) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  const quote = data['Global Quote'];
  if (!quote || !quote['05. price']) {
    throw new Error(data['Note'] || data['Information'] || `No quote returned for ${ticker}`);
  }
  return parseFloat(quote['05. price']);
}

async function fetchDailyHistory(ticker, apiKey) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=full&apikey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  const data = await res.json();
  const series = data['Time Series (Daily)'];
  if (!series) {
    throw new Error(data['Note'] || data['Information'] || `No history returned for ${ticker}`);
  }
  return Object.entries(series)
    .map(([date, vals]) => ({ date, close: parseFloat(vals['4. close']) }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Rendering ----------

let txns = loadTxns();
let priceCache = loadPriceCache();
let priceChart = null;

function uniqueTickers() {
  return [...new Set(txns.map((t) => t.ticker))].sort();
}

function uniquePlatforms() {
  return [...new Set(txns.map((t) => t.platform))].sort();
}

function renderPlatformList() {
  const dl = document.getElementById('platform-list');
  dl.innerHTML = uniquePlatforms().map((p) => `<option value="${escapeHtml(p)}">`).join('');
}

function renderTickerSelect() {
  const sel = document.getElementById('chart-ticker-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">Select a ticker…</option>' +
    uniqueTickers().map((t) => `<option value="${t}">${t}</option>`).join('');
  if (uniqueTickers().includes(current)) sel.value = current;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderSummary(holdings) {
  const withPrice = holdings.filter((h) => h.marketValue != null);
  const totalCost = holdings.reduce((s, h) => s + h.totalCost, 0);
  const totalValue = withPrice.reduce((s, h) => s + h.marketValue, 0)
    + holdings.filter((h) => h.marketValue == null).reduce((s, h) => s + h.totalCost, 0);
  const totalGain = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  const positionsMissingPrice = holdings.length - withPrice.length;

  const gainClass = totalGain > 0 ? 'gain' : totalGain < 0 ? 'loss' : '';

  document.getElementById('summary-cards').innerHTML = `
    <div class="card">
      <div class="label">Total invested</div>
      <div class="value">${fmtUSD(totalCost)}</div>
      <div class="sub">${txns.length} lot${txns.length === 1 ? '' : 's'} across ${uniquePlatforms().length} platform${uniquePlatforms().length === 1 ? '' : 's'}</div>
    </div>
    <div class="card">
      <div class="label">Current value</div>
      <div class="value">${fmtUSD(totalValue)}</div>
      <div class="sub">${positionsMissingPrice > 0 ? `${positionsMissingPrice} position(s) need a price refresh` : 'all prices current'}</div>
    </div>
    <div class="card">
      <div class="label">Gain / loss</div>
      <div class="value ${gainClass}">${fmtUSD(totalGain)}</div>
      <div class="sub ${gainClass}">${fmtPct(totalGainPct)} overall</div>
    </div>
    <div class="card">
      <div class="label">Positions</div>
      <div class="value">${holdings.length}</div>
      <div class="sub">${uniqueTickers().length} unique ticker${uniqueTickers().length === 1 ? '' : 's'}</div>
    </div>
  `;
}

function renderHoldings(holdings) {
  const body = document.getElementById('holdings-body');
  if (holdings.length === 0) {
    body.innerHTML = '<tr><td colspan="9" class="empty-state">No positions logged yet — add your first purchase on the left.</td></tr>';
    return;
  }
  body.innerHTML = holdings.map((h) => {
    const gainClass = h.gainAbs > 0 ? 'gain' : h.gainAbs < 0 ? 'loss' : '';
    return `
      <tr>
        <td class="ticker-pill">${h.ticker}</td>
        <td><span class="platform-tag">${escapeHtml(h.platform)}</span></td>
        <td class="num">${fmtNum(h.totalShares)}</td>
        <td class="num">${fmtUSD(h.avgCost)}</td>
        <td class="num">${h.currentPrice != null ? fmtUSD(h.currentPrice) : '—'}</td>
        <td class="num">${h.marketValue != null ? fmtUSD(h.marketValue) : '—'}</td>
        <td class="num ${gainClass}">${h.gainAbs != null ? `${fmtUSD(h.gainAbs)} (${fmtPct(h.gainPct)})` : '—'}</td>
        <td class="num ${gainClass}">${h.annualized != null ? fmtPct(h.annualized) : '—'}</td>
        <td></td>
      </tr>`;
  }).join('');
}

function renderTxns() {
  const body = document.getElementById('txn-body');
  if (txns.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty-state">Nothing logged yet.</td></tr>';
    return;
  }
  const sorted = [...txns].sort((a, b) => new Date(b.date) - new Date(a.date));
  body.innerHTML = sorted.map((t) => `
    <tr>
      <td>${t.date}</td>
      <td class="ticker-pill">${t.ticker}</td>
      <td><span class="platform-tag">${escapeHtml(t.platform)}</span></td>
      <td class="num">${fmtNum(t.shares)}</td>
      <td class="num">${fmtUSD(t.price)}</td>
      <td class="num">${fmtUSD(t.fees || 0)}</td>
      <td class="num">${fmtUSD(lotCostBasis(t))}</td>
      <td><button type="button" class="link-btn" data-id="${t.id}">remove</button></td>
    </tr>
  `).join('');

  body.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      txns = txns.filter((t) => t.id !== btn.dataset.id);
      saveTxns(txns);
      renderAll();
    });
  });
}

function renderAll() {
  const holdings = groupHoldings(txns, priceCache);
  renderSummary(holdings);
  renderHoldings(holdings);
  renderTxns();
  renderPlatformList();
  renderTickerSelect();
}

// ---------- Event wiring ----------

document.getElementById('api-key').value = loadApiKey();

document.getElementById('save-key').addEventListener('click', () => {
  const key = document.getElementById('api-key').value.trim();
  saveApiKey(key);
  const el = document.getElementById('key-status');
  el.textContent = key ? 'Key saved locally.' : 'Key cleared.';
  el.className = 'status-line ok';
});

document.getElementById('txn-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const txn = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    ticker: document.getElementById('ticker').value.trim().toUpperCase(),
    shares: parseFloat(document.getElementById('shares').value),
    price: parseFloat(document.getElementById('price').value),
    date: document.getElementById('date').value,
    fees: parseFloat(document.getElementById('fees').value || 0),
    platform: document.getElementById('platform').value.trim(),
  };
  txns.push(txn);
  saveTxns(txns);
  e.target.reset();
  renderAll();
});

document.getElementById('refresh-prices').addEventListener('click', async () => {
  const apiKey = loadApiKey();
  const status = document.getElementById('refresh-status');
  if (!apiKey) {
    status.textContent = 'Add your Alpha Vantage API key in the sidebar first.';
    status.className = 'status-line err';
    return;
  }
  const tickers = uniqueTickers();
  if (tickers.length === 0) {
    status.textContent = 'No tickers to refresh yet.';
    status.className = 'status-line';
    return;
  }
  status.textContent = `Fetching prices for ${tickers.length} ticker(s)…`;
  status.className = 'status-line';

  let failed = [];
  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    try {
      const price = await fetchQuote(ticker, apiKey);
      priceCache[ticker] = { price, asOf: new Date().toISOString() };
      savePriceCache(priceCache);
      renderAll();
    } catch (err) {
      failed.push(ticker);
    }
    // Free-tier Alpha Vantage is rate-limited (~5 req/min) — space calls out.
    if (i < tickers.length - 1) await sleep(1300);
  }

  if (failed.length === 0) {
    status.textContent = `Prices updated ${new Date().toLocaleTimeString()}.`;
    status.className = 'status-line ok';
  } else {
    status.textContent = `Updated, but failed for: ${failed.join(', ')} (rate limit or invalid ticker).`;
    status.className = 'status-line err';
  }
});

document.getElementById('load-history').addEventListener('click', async () => {
  const ticker = document.getElementById('chart-ticker-select').value;
  const apiKey = loadApiKey();
  const status = document.getElementById('chart-status');
  if (!ticker) {
    status.textContent = 'Pick a ticker first.';
    status.className = 'status-line err';
    return;
  }
  if (!apiKey) {
    status.textContent = 'Add your Alpha Vantage API key in the sidebar first.';
    status.className = 'status-line err';
    return;
  }
  status.textContent = 'Loading history…';
  status.className = 'status-line';
  try {
    const history = await fetchDailyHistory(ticker, apiKey);
    const lots = txns.filter((t) => t.ticker === ticker);
    renderChart(ticker, history, lots);
    status.textContent = `Loaded ${history.length} trading days.`;
    status.className = 'status-line ok';
  } catch (err) {
    status.textContent = err.message || 'Could not load history.';
    status.className = 'status-line err';
  }
});

function renderChart(ticker, history, lots) {
  const ctx = document.getElementById('price-chart');
  const labels = history.map((h) => h.date);
  const prices = history.map((h) => h.close);

  const buyPoints = lots.map((lot) => {
    const idx = labels.indexOf(lot.date);
    return { x: idx >= 0 ? lot.date : labels[0], y: lot.price };
  });

  if (priceChart) priceChart.destroy();
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `${ticker} close`,
          data: prices,
          borderColor: '#3d5a80',
          backgroundColor: 'rgba(61,90,128,0.08)',
          pointRadius: 0,
          borderWidth: 1.5,
          tension: 0.1,
          fill: true,
        },
        {
          label: 'Your purchases',
          type: 'scatter',
          data: buyPoints,
          backgroundColor: '#b34a3c',
          borderColor: '#b34a3c',
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'nearest', intersect: false },
      scales: {
        x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } },
        y: { ticks: { callback: (v) => `$${v}` } },
      },
      plugins: {
        legend: { labels: { font: { family: 'IBM Plex Mono', size: 11 } } },
      },
    },
  });
}

// ---------- Init ----------

renderAll();
