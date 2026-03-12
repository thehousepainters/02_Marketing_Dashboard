/* ============================================================
   page-tracker.js — Tab 4: Page Tracker
   Data source: Windsor.ai → searchconsole connector
   Tracks specific URLs from TRACKED_PAGES config and shows
   position, clicks, impressions, CTR vs prior period.
   ============================================================ */

'use strict';

const PageTracker = (() => {
  const GSC_ACCOUNT = 'https://thehousepainters.co.nz/';
  const ENDPOINT    = 'https://connectors.windsor.ai/searchconsole';

  let currentRange = 7;

  // ── Date builders ──────────────────────────────────────────
  function buildDates(days, offsetDays = 0) {
    const to = new Date();
    to.setDate(to.getDate() - 1 - offsetDays);
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    return { date_from: toISODate(from), date_to: toISODate(to) };
  }

  // ── Windsor fetch ─────────────────────────────────────────
  async function fetchGSC(fields, dates) {
    const key = AppConfig.get('WINDSOR_API_KEY');
    if (!key) throw new Error('Windsor.ai API key required — add in Settings.');
    const p = new URLSearchParams({
      api_key:  key,
      accounts: GSC_ACCOUNT,
      fields:   fields.join(','),
      ...dates,
    });
    const res = await fetch(`${ENDPOINT}?${p}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Windsor GSC ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    return json.data || json.result || [];
  }

  // ── Build page-level map: url → { clicks, impressions, position, ctr } ──
  function buildPageMap(rows) {
    const map = {};
    rows.forEach(r => {
      if (!r.page) return;
      if (!map[r.page]) map[r.page] = { clicks: 0, impressions: 0, posWtSum: 0, posImprSum: 0 };
      const m = map[r.page];
      m.clicks      += r.clicks      || 0;
      m.impressions += r.impressions || 0;
      // Impression-weighted position for accurate avg
      m.posWtSum    += (r.position || 99) * (r.impressions || 0);
      m.posImprSum  += r.impressions || 0;
    });
    const out = {};
    Object.entries(map).forEach(([url, m]) => {
      out[url] = {
        clicks:      m.clicks,
        impressions: m.impressions,
        position:    m.posImprSum > 0 ? m.posWtSum / m.posImprSum : 99,
        ctr:         m.impressions > 0 ? m.clicks / m.impressions : 0,
      };
    });
    return out;
  }

  // ── Build per-page keyword map: url → [sorted keyword rows] ──
  function buildKeywordMap(rows) {
    const map = {};
    rows.forEach(r => {
      if (!r.page || !r.query) return;
      if (!map[r.page]) map[r.page] = {};
      const q = r.query;
      if (!map[r.page][q]) map[r.page][q] = { query: q, clicks: 0, impressions: 0, posSum: 0, count: 0 };
      const m = map[r.page][q];
      m.clicks      += r.clicks      || 0;
      m.impressions += r.impressions || 0;
      m.posSum      += r.position    || 0;
      m.count++;
    });
    const out = {};
    Object.entries(map).forEach(([url, queries]) => {
      out[url] = Object.values(queries)
        .map(q => ({ ...q, position: q.count > 0 ? q.posSum / q.count : 99 }))
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 8); // top 8 keywords per page
    });
    return out;
  }

  // ── Zone helpers (mirrors seo.js) ─────────────────────────
  function getZone(pos) {
    if (pos <= 5)  return 'win';
    if (pos <= 20) return 'opportunity';
    if (pos <= 50) return 'dead';
    return 'beyond';
  }

  function zoneBadge(pos) {
    const z = getZone(pos);
    const cfg = {
      win:         { label: 'P1 WIN',      cls: 'badge--green' },
      opportunity: { label: 'OPPORTUNITY', cls: 'badge--amber' },
      dead:        { label: 'DEAD ZONE',   cls: 'badge--red'   },
      beyond:      { label: 'P5+',         cls: 'badge--grey'  },
    };
    return `<span class="badge ${cfg[z].cls}">${cfg[z].label}</span>`;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Trend badge ───────────────────────────────────────────
  // lowerIsBetter: for position (lower number = better rank)
  // format: 'pos' = show decimal | 'pct' = show percentage
  function trendBadge(change, lowerIsBetter, format) {
    if (change === null || change === undefined || isNaN(change) || Math.abs(change) < 0.1) {
      return '<span class="text-muted">—</span>';
    }
    const improved = lowerIsBetter ? change > 0 : change > 0;
    const cls      = improved ? 'pos-up' : 'pos-down';
    const arrow    = improved ? '↑' : '↓';
    const display  = format === 'pct'
      ? Math.abs(change).toFixed(0) + '%'
      : Math.abs(change).toFixed(1);
    return `<span class="${cls}">${arrow} ${display}</span>`;
  }

  // ── Metric cell ───────────────────────────────────────────
  function metricCell(label, value, change, lowerIsBetter, format) {
    return `
      <div class="pt-metric">
        <div class="pt-metric-value">${value}</div>
        <div class="pt-metric-change">${trendBadge(change, lowerIsBetter, format)}</div>
        <div class="pt-metric-label">${label}</div>
      </div>
    `;
  }

  // ── Keyword mini-table ────────────────────────────────────
  function renderKeywordMini(keywords) {
    if (!keywords || !keywords.length) return '';
    return `
      <div class="pt-keywords">
        <div class="pt-keywords-title">Top Keywords this period</div>
        <div class="table-wrapper" style="margin:0">
          <table class="data-table data-table--compact">
            <thead>
              <tr>
                <th>Keyword</th>
                <th>Pos</th>
                <th>Clicks</th>
                <th>Impressions</th>
              </tr>
            </thead>
            <tbody>
              ${keywords.map(k => `
                <tr>
                  <td>${esc(k.query)}</td>
                  <td><strong>${Math.round(k.position)}</strong></td>
                  <td>${formatNumber(k.clicks)}</td>
                  <td>${formatNumber(k.impressions)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ── Render a single page card ─────────────────────────────
  function renderPageCard(url, curr, prev, keywords) {
    const path = url.replace('https://thehousepainters.co.nz', '') || '/';

    // No data in GSC for this URL
    if (!curr) {
      return `
        <div class="card pt-card pt-card--empty">
          <div class="pt-card-header">
            <div class="pt-url-group">
              <a href="${esc(url)}" target="_blank" rel="noopener"
                 class="pt-url" title="${esc(url)}">${esc(path)}</a>
              <span class="badge badge--grey">NO GSC DATA</span>
            </div>
            <span class="text-muted" style="font-size:0.8rem">
              This URL had no impressions in Search Console for the selected period,
              or the path may differ slightly from what GSC records.
            </span>
          </div>
        </div>
      `;
    }

    // Position change: positive value means position number fell (improved)
    const posChange = prev ? prev.position - curr.position : null;
    // Click/impression % change vs previous period
    const clkChange = (prev && prev.clicks > 0)
      ? ((curr.clicks - prev.clicks) / prev.clicks) * 100 : null;
    const impChange = (prev && prev.impressions > 0)
      ? ((curr.impressions - prev.impressions) / prev.impressions) * 100 : null;
    // CTR change in percentage points (×100 for display formatting)
    const ctrChange = prev ? (curr.ctr - prev.ctr) * 100 : null;

    return `
      <div class="card pt-card">
        <div class="pt-card-header">
          <div class="pt-url-group">
            <a href="${esc(url)}" target="_blank" rel="noopener"
               class="pt-url" title="${esc(url)}">${esc(path)}</a>
            ${zoneBadge(curr.position)}
          </div>
          <span class="text-muted pt-full-url">${esc(url)}</span>
        </div>

        <div class="pt-metrics-grid">
          ${metricCell('Avg Position',  curr.position.toFixed(1),          posChange, true,  'pos')}
          ${metricCell('Clicks',        formatNumber(curr.clicks),          clkChange, false, 'pct')}
          ${metricCell('Impressions',   formatNumber(curr.impressions),     impChange, false, 'pct')}
          ${metricCell('CTR',           (curr.ctr * 100).toFixed(1) + '%', ctrChange, false, 'pos')}
        </div>

        ${renderKeywordMini(keywords)}
      </div>
    `;
  }

  // ── Summary strip (shown when ≥ 2 tracked pages) ──────────
  function renderSummaryStrip(trackedPages, currMap) {
    const found    = trackedPages.filter(u => currMap[u]);
    const missing  = trackedPages.length - found.length;
    const totalClk = found.reduce((s, u) => s + currMap[u].clicks, 0);
    const avgPos   = found.length > 0
      ? found.reduce((s, u) => s + currMap[u].position, 0) / found.length
      : null;

    return `
      <div class="pt-summary-strip">
        <div class="pt-summary-item">
          <span class="pt-summary-value">${found.length}</span>
          <span class="pt-summary-label">Pages with data</span>
        </div>
        <div class="pt-summary-item">
          <span class="pt-summary-value">${avgPos !== null ? avgPos.toFixed(1) : '—'}</span>
          <span class="pt-summary-label">Avg GSC position</span>
        </div>
        <div class="pt-summary-item">
          <span class="pt-summary-value">${formatNumber(totalClk)}</span>
          <span class="pt-summary-label">Total clicks</span>
        </div>
        ${missing > 0 ? `
          <div class="pt-summary-item pt-summary-item--warn">
            <span class="pt-summary-value">${missing}</span>
            <span class="pt-summary-label">No GSC data</span>
          </div>` : ''}
      </div>
    `;
  }

  // ── Main load ─────────────────────────────────────────────
  async function loadPageTracker() {
    const trackedPages = AppConfig.get('TRACKED_PAGES') || [];
    const list = document.getElementById('ptPagesList');
    if (!list) return;

    // No pages configured
    if (!trackedPages.length) {
      list.innerHTML = `
        <div class="card">
          <div class="coming-soon">
            <div class="coming-soon__icon">📄</div>
            <p class="coming-soon__title">No pages tracked yet</p>
            <p class="coming-soon__text">Go to <strong>Settings → Tracked Pages</strong> to add service page URLs to monitor.</p>
          </div>
        </div>
      `;
      return;
    }

    // No API key
    if (!AppConfig.get('WINDSOR_API_KEY')) {
      list.innerHTML = `
        <div class="card">
          <div class="coming-soon">
            <div class="coming-soon__icon">🔑</div>
            <p class="coming-soon__title">Windsor.ai API key required</p>
            <p class="coming-soon__text">Add your Windsor.ai API key in <strong>Settings</strong> to load Search Console data for your tracked pages.</p>
          </div>
        </div>
      `;
      return;
    }

    showLoading(true);

    const currDates = buildDates(currentRange);
    const prevDates = buildDates(currentRange, currentRange);

    let currMap = {}, prevMap = {}, kwMap = {};

    try {
      // Fetch current period, previous period, and per-page keywords — all in parallel.
      // Keyword (page+query) fetch is optional — silently degraded if it fails.
      const [currRows, prevRows, kwRows] = await Promise.all([
        fetchGSC(['page', 'clicks', 'impressions', 'ctr', 'position'], currDates),
        fetchGSC(['page', 'clicks', 'impressions', 'position'],         prevDates),
        fetchGSC(['page', 'query', 'clicks', 'impressions', 'position'], currDates)
          .catch(err => {
            console.warn('[PageTracker] Keyword fetch failed (keywords hidden):', err.message);
            return [];
          }),
      ]);

      currMap = buildPageMap(currRows);
      prevMap = buildPageMap(prevRows);
      kwMap   = buildKeywordMap(kwRows);

    } catch (err) {
      console.error('[PageTracker] Fetch failed:', err);
      list.innerHTML = `
        <div class="card">
          <div class="card-header"><h3 class="card-title">Page Tracker</h3></div>
          <p style="padding:1.5rem;color:var(--red)">
            Failed to load data: ${esc(err.message)}
          </p>
        </div>
      `;
      showLoading(false);
      setText('ptLastUpdated', `Last updated: ${timestampNow()}`);
      return;
    }

    // Build card for each tracked page
    const cardHtml = trackedPages.map(url =>
      renderPageCard(url, currMap[url] || null, prevMap[url] || null, kwMap[url] || [])
    );

    // Summary strip when multiple pages tracked
    const summaryHtml = trackedPages.length >= 2
      ? renderSummaryStrip(trackedPages, currMap)
      : '';

    list.innerHTML = summaryHtml + cardHtml.join('');

    showLoading(false);
    setText('ptLastUpdated', `Last updated: ${timestampNow()}`);
  }

  // ── Helpers ───────────────────────────────────────────────
  function showLoading(on) {
    const spin    = document.getElementById('ptLoading');
    const content = document.getElementById('ptContent');
    if (spin)    spin.style.display    = on ? 'flex' : 'none';
    if (content) content.style.display = on ? 'none'  : 'block';
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    // Date selector
    document.getElementById('ptDateSelector')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      document.querySelectorAll('#ptDateSelector .date-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = parseInt(btn.dataset.range) || 7;
      loadPageTracker();
    });

    // Refresh button
    document.getElementById('ptRefreshBtn')?.addEventListener('click', loadPageTracker);

    // Auto-load on init if key present
    if (AppConfig.get('WINDSOR_API_KEY')) loadPageTracker();
  }

  return { init, loadPageTracker };
})();
