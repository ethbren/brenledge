# Ledger — a personal, multi-broker stock return tracker

A small local website (no build step, no server required) for logging every
stock purchase you make — across any number of brokers — and tracking your
real, time-weighted rate of return per position and overall.

## Setup

1. Move this whole `stock_website` folder to:
   `/Users/ethanbrenny/Desktop/All/coding/fun_projects/stock_website`
2. Get a free Alpha Vantage API key (used for live prices + history):
   https://www.alphavantage.co/support/#api-key
3. Open `index.html`. Because some browsers restrict `fetch()` from a raw
   `file://` page, it's more reliable to serve it locally instead of
   double-clicking it. From inside the folder, run one of:

   ```bash
   # Python (usually already installed on macOS)
   python3 -m http.server 8000

   # or, if you have Node
   npx serve .
   ```

   Then open `http://localhost:8000` in your browser.
4. Paste your Alpha Vantage key into the "Price data" box in the sidebar
   and click **Save key**. It's stored only in your browser's localStorage —
   nothing leaves your machine except direct calls to Alpha Vantage.

## Using it

- **Log a purchase** — ticker, shares, price paid, date, and which
  platform/broker it was on. Add every lot separately (e.g. three DCA buys
  of the same stock on the same broker become three rows).
- **Holdings** — your lots are rolled up per ticker + platform, showing
  average cost, current price, market value, gain/loss, and an
  **annualized return** (compound-growth rate, so a position held 3 months
  and one held 3 years are comparable).
- **Refresh prices** — pulls the latest quote per ticker from Alpha Vantage.
  The free tier is rate-limited (roughly 5 requests/minute, 25/day), so the
  app spaces requests out automatically — refresh only when you need it.
- **Price history chart** — pick a ticker to plot its historical close price,
  with red markers showing exactly where your purchases landed.
- **Transaction log** — every lot you've entered, newest first, with a
  remove button if you need to correct an entry.

## Notes on the return calculation

For a holding built from multiple lots, the annualized return is computed
using a cost-weighted average holding period across the lots, then:

```
((current value / total cost basis) ^ (365 / weighted days held)) − 1
```

This is a solid approximation for comparing positions, but it isn't a true
cash-flow-aware IRR (XIRR). If you want XIRR-level precision later, that's a
reasonable next feature to add — flag it and I can build it in.

## Extending it

Everything is plain HTML/CSS/JS with no build tooling:

- `index.html` — page structure
- `style.css` — design system (colors, type, layout all as CSS variables)
- `app.js` — storage, calculations, Alpha Vantage calls, and Chart.js rendering

All data lives in `localStorage` under keys prefixed `ledger_`. Clearing your
browser's site data for this page will wipe your transaction log, so if you
want a backup, you can export it any time from the browser console:

```js
copy(localStorage.getItem('ledger_txns_v1'))
```
