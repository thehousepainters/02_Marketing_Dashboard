/* ============================================================
   seo.js — Tab 2: SEO Rankings & Daily Alerts
   Data source: Windsor.ai → searchconsole connector
   ============================================================ */

'use strict';

const SEO = (() => {
  const GSC_ACCOUNT = 'https://thehousepainters.co.nz/';
  const ENDPOINT    = 'https://connectors.windsor.ai/searchconsole';

  let currentRange     = 7;
  let allKeywords      = [];
  let currentZone      = 'all';
  let sortCfg          = { field: 'clicks', dir: 'desc' };

  // ── Date builders ──────────────────────────────────────────
  function buildDates(days, offsetDays = 0) {
    const to = new Date();
    to.setDate(to.getDate() - 1 - offsetDays);
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    return { date_from: toISODate(from), date_to: toISODate(to) };
  }

  // ── Windsor fetch ─────────────────────────────────────────
  async function fetchGSC(fields, dates, filters = null) {
    const key = AppConfig.get('WINDSOR_API_KEY');
    if (!key) throw new Error('Windsor.ai API key required — add in Settings.');
    const p = new URLSearchParams({
      api_key:  key,
      accounts: GSC_ACCOUNT,
      fields:   fields.join(','),
      ...dates,
    });
    if (filters) p.set('filters', JSON.stringify(filters));
    const res = await fetch(`${ENDPOINT}?${p}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Windsor GSC ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    return json.data || json.result || [];
  }

  // ── Aggregation ───────────────────────────────────────────
  function aggregateByQuery(rows) {
    const map = {};
    rows.forEach(r => {
      if (!r.query) return;
      if (!map[r.query]) map[r.query] = { clicks: 0, impressions: 0, posSum: 0, count: 0 };
      const m = map[r.query];
      m.clicks      += r.clicks      || 0;
      m.impressions += r.impressions || 0;
      m.posSum      += r.position    || 0;
      m.count++;
    });
    return Object.entries(map).map(([q, m]) => ({
      query:       q,
      clicks:      m.clicks,
      impressions: m.impressions,
      ctr:         m.impressions > 0 ? m.clicks / m.impressions : 0,
      position:    m.count > 0 ? m.posSum / m.count : 99,
    }));
  }

  function buildPrevMap(rows) {
    const map = {};
    rows.forEach(r => {
      if (!r.query) return;
      if (!map[r.query]) map[r.query] = { sum: 0, n: 0 };
      map[r.query].sum += r.position || 0;
      map[r.query].n++;
    });
    const out = {};
    Object.entries(map).forEach(([q, v]) => { out[q] = v.n > 0 ? v.sum / v.n : 0; });
    return out;
  }

  // ── Zone helpers ──────────────────────────────────────────
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

  function posChangeBadge(change) {
    if (!change || Math.abs(change) < 0.5) return '<span class="text-muted">—</span>';
    // Positive change = position number decreased = improved
    if (change > 0) return `<span class="pos-up">↑${Math.abs(change).toFixed(0)}</span>`;
    return `<span class="pos-down">↓${Math.abs(change).toFixed(0)}</span>`;
  }

  // ── Render: summary cards ─────────────────────────────────
  // pages     → complete site-level data (matches GSC totals)
  // keywords  → query-level data for zone counts only
  function renderSummaryCards(pages, keywords) {
    // Metric cards: use page-level totals (complete, matches GSC)
    const totalClicks      = pages.reduce((s, r) => s + (r.clicks || 0), 0);
    const totalImpressions = pages.reduce((s, r) => s + (r.impressions || 0), 0);
    const avgCTR           = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    // Weighted avg position across pages with impressions
    const posPages = pages.filter(p => p.impressions > 0);
    const avgPos   = posPages.length > 0
      ? posPages.reduce((s, p) => s + p.position * p.impressions, 0) /
        posPages.reduce((s, p) => s + p.impressions, 0) : 0;

    setText('seoTotalClicks',      formatNumber(totalClicks));
    setText('seoTotalImpressions', formatNumber(totalImpressions));
    setText('seoAvgCTR',           avgCTR.toFixed(2) + '%');
    setText('seoAvgPosition',      avgPos.toFixed(1));

    // Zone counts: use keyword-level positions (more granular)
    if (keywords && keywords.length) {
      const page1Count = keywords.filter(k => k.position <= 5).length;
      const oppCount   = keywords.filter(k => k.position > 5  && k.position <= 20).length;
      const deadCount  = keywords.filter(k => k.position > 20 && k.position <= 50).length;
      setText('seoPage1Count',   page1Count);
      setText('seoOppCount',     oppCount);
      setText('seoDeadCount',    deadCount);
      setText('seoKeywordCount', `${keywords.length} keywords`);
    }
  }

  // ── Render: alerts panel (collapsible) ───────────────────
  function renderAlerts(keywords) {
    const panel = document.getElementById('seoAlertPanel');
    const list  = document.getElementById('seoAlertList');
    if (!panel || !list) return;

    const drops    = [];
    const fellOff  = [];

    keywords.forEach(kw => {
      if (kw.prevPos && kw.posChange < -3) {
        drops.push(
          `<div class="alert-item">
            <span class="alert-bullet">●</span>
            <strong>"${esc(kw.query)}"</strong> dropped
            ${Math.abs(kw.posChange).toFixed(0)} positions —
            was #${Math.round(kw.prevPos)}, now <strong>#${Math.round(kw.position)}</strong>
          </div>`
        );
      }
      if (kw.prevPos && kw.prevPos <= 10 && kw.position > 10) {
        fellOff.push(
          `<div class="alert-item alert-item--critical">
            <span class="alert-bullet">🔴</span>
            <strong>"${esc(kw.query)}"</strong> FELL OFF PAGE 1 —
            was #${Math.round(kw.prevPos)}, now #${Math.round(kw.position)}
          </div>`
        );
      }
    });

    const total = drops.length + fellOff.length;
    if (!total) { panel.style.display = 'none'; return; }

    // Build summary line
    const parts = [];
    if (drops.length)   parts.push(`${drops.length} ranking drop${drops.length > 1 ? 's' : ''}`);
    if (fellOff.length) parts.push(`${fellOff.length} fell off page 1`);
    const summary = parts.join(' · ');

    // Inject collapsible header if not already present
    let header = panel.querySelector('.alert-header');
    if (!header) {
      header = document.createElement('div');
      header.className = 'alert-header';
      panel.insertBefore(header, list);
      header.addEventListener('click', () => {
        const open = list.style.display !== 'none';
        list.style.display = open ? 'none' : 'block';
        header.querySelector('.alert-toggle').textContent = open ? '▼ View details' : '▲ Hide details';
      });
    }

    header.innerHTML = `
      <span class="alert-header-icon">⚠</span>
      <span class="alert-header-text">Urgent — ${esc(summary)}</span>
      <button class="alert-toggle">▼ View details</button>
    `;

    list.innerHTML = [...fellOff, ...drops].join('');
    list.style.display = 'none'; // collapsed by default
    panel.style.display = 'block';
  }

  // ── Render: keyword table ─────────────────────────────────
  function renderKeywordTable() {
    const tbody = document.getElementById('seoKeywordsTableBody');
    if (!tbody) return;

    let data = [...allKeywords];
    if (currentZone === 'win')         data = data.filter(k => k.position <= 5);
    else if (currentZone === 'opportunity') data = data.filter(k => k.position > 5  && k.position <= 20);
    else if (currentZone === 'dead')    data = data.filter(k => k.position > 20 && k.position <= 50);

    data.sort((a, b) => {
      const av = a[sortCfg.field] ?? 0;
      const bv = b[sortCfg.field] ?? 0;
      return sortCfg.dir === 'desc' ? bv - av : av - bv;
    });

    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-empty">No keywords in this zone.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(kw => `
      <tr>
        <td class="td-keyword">${esc(kw.query)}</td>
        <td class="td-number"><strong>${Math.round(kw.position)}</strong></td>
        <td class="td-center">${posChangeBadge(kw.posChange)}</td>
        <td>${zoneBadge(kw.position)}</td>
        <td class="td-number">${formatNumber(kw.clicks)}</td>
        <td class="td-number">${formatNumber(kw.impressions)}</td>
        <td class="td-number">${(kw.ctr * 100).toFixed(1)}%</td>
      </tr>
    `).join('');
  }

  // ── Render: page performance table ───────────────────────
  function renderPageTable(pages) {
    const tbody = document.getElementById('seoPagesTableBody');
    if (!tbody) return;

    const sorted = [...pages]
      .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
      .slice(0, 40);

    tbody.innerHTML = sorted.map(pg => {
      const path = pg.page.replace('https://thehousepainters.co.nz', '') || '/';
      const flagLow = pg.position <= 20 && (pg.ctr * 100) < 2 && pg.impressions >= 50;
      return `
        <tr${flagLow ? ' class="row-amber"' : ''}>
          <td class="td-url">
            <a href="${esc(pg.page)}" target="_blank" rel="noopener"
               title="${esc(pg.page)}">${esc(path)}</a>
          </td>
          <td class="td-number">${formatNumber(pg.clicks)}</td>
          <td class="td-number">${formatNumber(pg.impressions)}</td>
          <td class="td-number${flagLow ? ' text-amber' : ''}">${(pg.ctr * 100).toFixed(1)}%</td>
          <td class="td-number">${pg.position.toFixed(1)}</td>
          <td>${zoneBadge(pg.position)}</td>
        </tr>
      `;
    }).join('');
  }

  // ── Load data ─────────────────────────────────────────────
  async function loadSEO() {
    showLoading(true);

    const currDates = buildDates(currentRange);
    const prevDates = buildDates(currentRange, currentRange);

    // ── 1. Page-level fetch (always works, run first) ────────
    let pages = [];
    try {
      const pgRaw = await fetchGSC(
        ['page', 'clicks', 'impressions', 'ctr', 'position'],
        currDates
      );
      pages = pgRaw.map(pg => ({
        page:        pg.page || '',
        clicks:      pg.clicks      || 0,
        impressions: pg.impressions || 0,
        ctr:         pg.ctr         || 0,
        position:    pg.position    || 99,
      }));
      renderPageTable(pages);
    } catch (err) {
      console.error('[SEO] Page fetch failed:', err);
      const tbody = document.getElementById('seoPagesTableBody');
      if (tbody) tbody.innerHTML =
        `<tr><td colspan="6" class="table-empty text-red">
          Page data unavailable: ${esc(err.message)}
         </td></tr>`;
    }

    // ── 2. Keyword fetches (independent try/catch) ───────────
    try {
      const [kwCurr, kwPrev] = await Promise.all([
        fetchGSC(['query', 'clicks', 'impressions', 'ctr', 'position'], currDates),
        fetchGSC(['query', 'position'], prevDates),
      ]);

      const prevMap = buildPrevMap(kwPrev);
      allKeywords = aggregateByQuery(kwCurr).map(kw => ({
        ...kw,
        prevPos:   prevMap[kw.query] || null,
        posChange: prevMap[kw.query] ? prevMap[kw.query] - kw.position : 0,
      }));

      renderSummaryCards(pages, allKeywords);
      renderAlerts(allKeywords);
      renderKeywordTable();
    } catch (err) {
      console.error('[SEO] Keyword fetch failed:', err);
      // Show error inline in keyword table instead of disappearing toast
      const tbody = document.getElementById('seoKeywordsTableBody');
      if (tbody) tbody.innerHTML =
        `<tr><td colspan="7" class="table-empty text-red">
          Keyword data unavailable: ${esc(err.message)}
         </td></tr>`;
      // Still populate summary metrics from page data if keywords failed
      if (pages.length) renderSummaryCards(pages, []);
    }

    setText('seoLastUpdated', `Last updated: ${timestampNow()}`);
    showLoading(false);
  }

  // ── Helpers ───────────────────────────────────────────────
  function showLoading(on) {
    const spin    = document.getElementById('seoLoading');
    const content = document.getElementById('seoContent');
    if (spin)    spin.style.display    = on ? 'flex' : 'none';
    if (content) content.style.display = on ? 'none'  : 'block';
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    // Date selector
    document.getElementById('seoDateSelector')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      document.querySelectorAll('#seoDateSelector .date-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = parseInt(btn.dataset.range) || 7;
      loadSEO();
    });

    // Refresh
    document.getElementById('seoRefreshBtn')?.addEventListener('click', loadSEO);

    // Zone filter
    document.getElementById('seoZoneFilter')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-zone]');
      if (!btn) return;
      document.querySelectorAll('#seoZoneFilter .zone-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentZone = btn.dataset.zone;
      renderKeywordTable();
    });

    // Table sort
    document.querySelectorAll('#seoKeywordsTable th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const f = th.dataset.sort;
        sortCfg = sortCfg.field === f
          ? { field: f, dir: sortCfg.dir === 'desc' ? 'asc' : 'desc' }
          : { field: f, dir: 'desc' };
        renderKeywordTable();
      });
    });

    // Auto-load
    if (AppConfig.get('WINDSOR_API_KEY')) loadSEO();
  }

  return { init, loadSEO };
})();
