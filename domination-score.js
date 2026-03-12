/* ============================================================
   domination-score.js — Tab 8: Market Domination Score
   Composite 0–100 score across 5 pillars:
     1. SEO Clicks       (25 pts) — organic traffic volume
     2. Ranking Quality  (20 pts) — keyword position distribution
     3. SEO Momentum     (15 pts) — traffic trend vs prior period
     4. Ad Efficiency    (25 pts) — Meta CPL / leads / ROAS
     5. Content CTR      (15 pts) — avg click-through rate
   Data: Windsor.ai GSC + Windsor.ai Meta (Meta is optional)
   ============================================================ */

'use strict';

const DominationScore = (() => {
  const GSC_ACCOUNT   = 'https://thehousepainters.co.nz/';
  const GSC_ENDPOINT  = 'https://connectors.windsor.ai/searchconsole';
  const META_ENDPOINT = 'https://connectors.windsor.ai/facebook';
  const STORAGE_KEY   = 'rc_domination_score';

  // ── Date helpers ─────────────────────────────────────────
  // daysBack=0 → most recent window ending yesterday
  // daysBack=28 → the window before that
  function buildDates(daysBack, windowDays) {
    const to = new Date();
    to.setDate(to.getDate() - 1 - daysBack);
    const from = new Date(to);
    from.setDate(from.getDate() - (windowDays - 1));
    return { date_from: toISODate(from), date_to: toISODate(to) };
  }

  // ── Windsor fetchers ──────────────────────────────────────
  async function fetchGSC(fields, dates) {
    const key = AppConfig.get('WINDSOR_API_KEY');
    if (!key) throw new Error('no-key');
    const p = new URLSearchParams({
      api_key:  key,
      accounts: GSC_ACCOUNT,
      fields:   fields.join(','),
      ...dates,
    });
    const res = await fetch(`${GSC_ENDPOINT}?${p}`);
    if (!res.ok) throw new Error(`GSC ${res.status}`);
    const json = await res.json();
    return json.data || json.result || [];
  }

  async function fetchMeta(dates) {
    const cfg = AppConfig.load();
    if (!cfg.WINDSOR_API_KEY || !cfg.META_ACCOUNT_ID) throw new Error('no-meta-cfg');
    const fields = [
      'spend', 'actions_lead', 'cost_per_action_type_lead',
      'website_purchase_roas_offsite_conversion_fb_pixel_purchase',
      'clicks', 'impressions',
    ].join(',');
    const p = new URLSearchParams({
      api_key:  cfg.WINDSOR_API_KEY,
      accounts: cfg.META_ACCOUNT_ID,
      fields,
      ...dates,
    });
    const res = await fetch(`${META_ENDPOINT}?${p}`);
    if (!res.ok) throw new Error(`Meta ${res.status}`);
    const json = await res.json();
    return Array.isArray(json) ? json : (json.data || []);
  }

  // ── Aggregate helpers ─────────────────────────────────────
  function sumClicks(rows) {
    return rows.reduce((s, r) => s + (parseFloat(r.clicks) || 0), 0);
  }

  function aggregateMeta(rows) {
    const spend  = rows.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0);
    const leads  = rows.reduce((s, r) => s + (parseInt(r.actions_lead) || 0), 0);
    const clicks = rows.reduce((s, r) => s + (parseInt(r.clicks) || 0), 0);
    const impr   = rows.reduce((s, r) => s + (parseInt(r.impressions) || 0), 0);
    const roasVals = rows
      .map(r => parseFloat(r.website_purchase_roas_offsite_conversion_fb_pixel_purchase) || 0)
      .filter(v => v > 0);
    const roas = roasVals.length
      ? roasVals.reduce((a, b) => a + b, 0) / roasVals.length : 0;
    const cpl  = leads > 0 ? spend / leads : 0;
    const ctr  = impr  > 0 ? (clicks / impr) * 100 : 0;
    return { spend, leads, cpl, roas, ctr, clicks, impr };
  }

  // ── PILLAR 1: SEO Clicks (25 pts) ────────────────────────
  // Benchmark: 400 clicks/28d = full score for Auckland trade business
  function scoreSeoClicks(pageRows) {
    const clicks = sumClicks(pageRows);
    const target = 400;
    const pts    = Math.min(25, Math.round((clicks / target) * 25));
    return {
      key:     'seoClicks',
      label:   'SEO Clicks',
      score:   pts,
      max:     25,
      clicks,
      insight: clicks >= target
        ? `${Math.round(clicks).toLocaleString()} organic clicks — strong visibility`
        : `${Math.round(clicks).toLocaleString()} clicks in 28 days · target: ${target} for full score`,
    };
  }

  // ── PILLAR 2: Ranking Quality (20 pts) ───────────────────
  // Impression-weighted average position per keyword, then bucket counts
  function scoreRankingQuality(kwRows) {
    const kwMap = {};
    kwRows.forEach(r => {
      if (!r.query) return;
      if (!kwMap[r.query]) kwMap[r.query] = { imprSum: 0, posWt: 0 };
      const impr = parseFloat(r.impressions) || 0;
      kwMap[r.query].imprSum += impr;
      kwMap[r.query].posWt  += (parseFloat(r.position) || 99) * impr;
    });

    const kws = Object.values(kwMap)
      .map(k => ({ pos: k.imprSum > 0 ? k.posWt / k.imprSum : 99, impr: k.imprSum }))
      .filter(k => k.impr >= 5); // ignore noise

    const p1_3   = kws.filter(k => k.pos >= 1 && k.pos <= 3).length;
    const p4_10  = kws.filter(k => k.pos >  3 && k.pos <= 10).length;
    const p11_20 = kws.filter(k => k.pos > 10 && k.pos <= 20).length;

    // p1-3 worth 2.5 each (cap: 8 = 20pts), p4-10 worth 0.8, p11-20 worth 0.3
    const raw = p1_3 * 2.5 + p4_10 * 0.8 + p11_20 * 0.3;
    const pts = Math.min(20, Math.round(raw));

    const topNote = p1_3 > 0
      ? `${p1_3} keyword${p1_3 !== 1 ? 's' : ''} in top 3`
      : p4_10 > 0
        ? `${p4_10} keywords in top 10 — none in top 3 yet`
        : 'No keywords in top 10 — content needed';

    return {
      key:    'rankQuality',
      label:  'Ranking Quality',
      score:  pts,
      max:    20,
      p1_3, p4_10, p11_20,
      insight: `${topNote} · ${p4_10} in top 10 · ${p11_20} in top 20`,
    };
  }

  // ── PILLAR 3: SEO Momentum (15 pts) ──────────────────────
  function scoreMomentum(currPageRows, prevPageRows) {
    const curr = sumClicks(currPageRows);
    const prev = sumClicks(prevPageRows);

    let pts, insight;
    if (prev < 5) {
      pts     = 8;
      insight = 'Baseline being established — not enough prior-period data';
    } else {
      const growth = (curr - prev) / prev;
      const pct    = (Math.abs(growth) * 100).toFixed(1);
      if      (growth >= 0.20)  pts = 15;
      else if (growth >= 0.10)  pts = 12;
      else if (growth >= 0.00)  pts = 8;
      else if (growth >= -0.10) pts = 5;
      else                       pts = 2;
      const dir = growth >= 0 ? '▲' : '▼';
      insight = `${dir} ${pct}% vs prior 28-day period (${Math.round(prev)} → ${Math.round(curr)} clicks)`;
    }

    return { key: 'momentum', label: 'SEO Momentum', score: pts, max: 15, curr, prev, insight };
  }

  // ── PILLAR 4: Ad Efficiency (25 pts) ─────────────────────
  function scoreAdEfficiency(meta) {
    if (!meta || (meta.spend === 0 && meta.leads === 0)) {
      return {
        key:    'adEfficiency',
        label:  'Ad Efficiency',
        score:  0,
        max:    25,
        noData: true,
        insight: 'No Meta Ads data — add your Meta account ID in Settings to score this pillar',
      };
    }

    const { cpl, leads, roas, spend } = meta;

    // CPL sub-score (0–15): lower CPL = better
    let cplPts;
    if (leads === 0)     cplPts = spend > 10 ? 0 : 6; // spent with no leads
    else if (cpl <= 50)  cplPts = 15;
    else if (cpl <= 65)  cplPts = 12;
    else if (cpl <= 80)  cplPts = 9;
    else if (cpl <= 100) cplPts = 5;
    else if (cpl <= 130) cplPts = 2;
    else                  cplPts = 0;

    // Leads volume sub-score (0–5)
    const leadsPts = leads >= 20 ? 5 : leads >= 10 ? 4 : leads >= 5 ? 3 : leads >= 1 ? 2 : 0;

    // ROAS sub-score (0–5)
    const roasPts = roas >= 3 ? 5 : roas >= 2 ? 3 : roas >= 1 ? 1 : 0;

    const total   = cplPts + leadsPts + roasPts;
    const cplStr  = leads > 0 ? `$${Math.round(cpl)} CPL` : `$${Math.round(spend)} spent, 0 leads`;
    const roasStr = roas > 0 ? ` · ${roas.toFixed(1)}x ROAS` : '';

    return {
      key:    'adEfficiency',
      label:  'Ad Efficiency',
      score:  total,
      max:    25,
      meta,
      cplPts, leadsPts, roasPts,
      insight: `${leads} lead${leads !== 1 ? 's' : ''} · ${cplStr}${roasStr} (7-day window)`,
    };
  }

  // ── PILLAR 5: Content CTR (15 pts) ───────────────────────
  function scoreContentCTR(pageRows) {
    const pageMap = {};
    pageRows.forEach(r => {
      if (!r.page) return;
      if (!pageMap[r.page]) pageMap[r.page] = { clicks: 0, impressions: 0 };
      pageMap[r.page].clicks      += parseFloat(r.clicks)      || 0;
      pageMap[r.page].impressions += parseFloat(r.impressions) || 0;
    });

    const qualified = Object.values(pageMap).filter(p => p.impressions >= 30);
    if (!qualified.length) {
      return {
        key: 'contentCTR', label: 'Content CTR',
        score: 5, max: 15, avgCtr: 0, pageCount: 0,
        insight: 'Not enough impression data yet — pages need more visibility',
      };
    }

    const totClicks = qualified.reduce((s, p) => s + p.clicks, 0);
    const totImpr   = qualified.reduce((s, p) => s + p.impressions, 0);
    const avgCtr    = totImpr > 0 ? (totClicks / totImpr) * 100 : 0;
    const highCtr   = qualified.filter(p => (p.clicks / p.impressions) > 0.04).length;

    let pts;
    if      (avgCtr >= 5) pts = 15;
    else if (avgCtr >= 4) pts = 12;
    else if (avgCtr >= 3) pts = 9;
    else if (avgCtr >= 2) pts = 6;
    else if (avgCtr >= 1) pts = 3;
    else                   pts = 1;

    return {
      key:       'contentCTR',
      label:     'Content CTR',
      score:     pts,
      max:       15,
      avgCtr,
      pageCount: qualified.length,
      highCtr,
      insight:   `${avgCtr.toFixed(1)}% avg CTR across ${qualified.length} pages · ${highCtr} page${highCtr !== 1 ? 's' : ''} above 4%`,
    };
  }

  // ── SVG Gauge (3/4-circle speedometer) ───────────────────
  function buildGaugeSVG(score) {
    const cx = 60, cy = 58, r = 46;
    const c      = 2 * Math.PI * r;  // ~289
    const arc    = c * 0.75;         // 270° sweep ~217
    const gap    = c - arc;
    const filled = Math.max(3, (score / 100) * arc);

    const color = score >= 80 ? '#10b981'
                : score >= 60 ? '#f59e0b'
                : score >= 40 ? '#f97316'
                :               '#ef4444';

    const label = score >= 80 ? 'Dominating'
                : score >= 60 ? 'Competitive'
                : score >= 40 ? 'Building'
                :               'Struggling';

    return `
      <g transform="rotate(135 ${cx} ${cy})">
        <circle cx="${cx}" cy="${cy}" r="${r}"
          fill="none" stroke="#e5e7eb" stroke-width="10"
          stroke-dasharray="${arc.toFixed(2)} ${gap.toFixed(2)}"
          stroke-linecap="round"/>
        <circle cx="${cx}" cy="${cy}" r="${r}"
          fill="none" stroke="${color}" stroke-width="10"
          stroke-dasharray="${filled.toFixed(2)} ${(c - filled).toFixed(2)}"
          stroke-linecap="round"/>
      </g>
      <text x="${cx}" y="${cy - 5}" text-anchor="middle"
        font-size="32" font-weight="800" fill="#111827"
        font-family="Inter,system-ui,sans-serif">${score}</text>
      <text x="${cx}" y="${cy + 13}" text-anchor="middle"
        font-size="11" fill="#9ca3af"
        font-family="Inter,system-ui,sans-serif">out of 100</text>
      <text x="${cx}" y="${cy + 30}" text-anchor="middle"
        font-size="12" font-weight="700" fill="${color}"
        font-family="Inter,system-ui,sans-serif">${label}</text>
    `;
  }

  // ── Pillar progress bar ───────────────────────────────────
  function buildPillarBar(pillar) {
    const pct   = Math.round((pillar.score / pillar.max) * 100);
    const color = pct >= 75 ? 'var(--green)'
                : pct >= 45 ? 'var(--amber)'
                :             'var(--red)';
    const noDataNote = pillar.noData
      ? '<span class="ds-pillar-nodata">not connected</span>' : '';

    return `
      <div class="ds-pillar">
        <div class="ds-pillar-header">
          <span class="ds-pillar-label">${pillar.label}${noDataNote}</span>
          <span class="ds-pillar-score" style="color:${color}">
            ${pillar.score}<span class="ds-pillar-max">/${pillar.max}</span>
          </span>
        </div>
        <div class="ds-pillar-track">
          <div class="ds-pillar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="ds-pillar-insight">${pillar.insight}</div>
      </div>
    `;
  }

  // ── Key metric tile ───────────────────────────────────────
  function buildMetricTile(label, value, sub) {
    return `
      <div class="ds-metric">
        <div class="ds-metric-value">${value}</div>
        <div class="ds-metric-label">${label}</div>
        ${sub ? `<div class="ds-metric-sub">${sub}</div>` : ''}
      </div>
    `;
  }

  // ── "What to focus on" insights ───────────────────────────
  const ADVICE = {
    seoClicks: {
      low:  'Organic traffic is low. Use the Action Plan tab — blog post ideas backed by real keyword data are the fastest way to grow clicks.',
      mid:  'Solid traffic but room to grow. Push top 10 keywords into top 3 to capture more clicks without new content.',
      high: 'Strong organic traffic. Protect rankings by refreshing top-performing pages and building internal links between them.',
    },
    rankQuality: {
      low:  'Few keywords rank on page 1. Pick 2–3 location + service pages (e.g. "exterior painting Remuera") and build backlinks to them.',
      mid:  'Some top-10 rankings but gaps remain. Add FAQ schema and strengthen title tags to push page-2 keywords into top 5.',
      high: 'Strong ranking positions. Add more suburb-specific landing pages to multiply your top-10 footprint across Auckland.',
    },
    momentum: {
      low:  'Traffic is declining. Check the Page Tracker for pages that have dropped, review for crawl errors, and refresh thin content.',
      mid:  'Traffic is flat. A consistent publishing schedule (even 1 post/month) should push this upward consistently.',
      high: 'Traffic is growing — great sign. Identify which new pages drove growth and replicate that content pattern.',
    },
    adEfficiency: {
      low:  'Ads are expensive or not converting. Open the War Room — STOP the worst performers today and redirect budget to winners.',
      mid:  'Ads are working but not optimally. Test new creative concepts from the War Room and tighten your audience targeting.',
      high: 'Ads are efficient. Scale budget on your best performers and test new creative to maintain momentum.',
    },
    contentCTR: {
      low:  'Pages appear in search but few people click. Rewrite title tags: include a benefit + location (e.g. "Auckland Exterior Painters — 5★ Rated. Free Quotes").',
      mid:  'CTR is reasonable. A/B test meta descriptions on your top 5 pages — a clear call-to-action lifts clicks significantly.',
      high: 'Great click-through rate. Titles and descriptions are compelling — don\'t make unnecessary changes to these pages.',
    },
  };

  function buildInsights(pillars) {
    // Sort by score % ascending — lowest first = biggest opportunities
    const ranked = [...pillars].sort((a, b) => (a.score / a.max) - (b.score / b.max));
    const focus  = ranked.slice(0, 2); // 2 lowest = priorities
    const best   = ranked[ranked.length - 1]; // 1 highest = keep

    const getLevel = p => {
      const pct = p.score / p.max;
      return pct >= 0.75 ? 'high' : pct >= 0.45 ? 'mid' : 'low';
    };

    const rows = focus.map(p => {
      const lvl   = getLevel(p);
      const pct   = Math.round((p.score / p.max) * 100);
      const color = pct >= 75 ? '#10b981' : pct >= 45 ? '#f59e0b' : '#ef4444';
      const icon  = pct >= 75 ? '✓' : pct >= 45 ? '→' : '↑';
      return `
        <div class="ds-insight-row">
          <span class="ds-insight-badge" style="background:${color}20;color:${color}">
            ${icon} ${p.label}
          </span>
          <span class="ds-insight-text">${ADVICE[p.key]?.[lvl] || ''}</span>
        </div>
      `;
    }).join('');

    const bestPct = Math.round((best.score / best.max) * 100);
    const keepRow = bestPct >= 65 ? `
      <div class="ds-insight-row ds-insight-row--keep">
        <span class="ds-insight-badge ds-insight-badge--keep">🏆 Strength: ${best.label}</span>
        <span class="ds-insight-text">${ADVICE[best.key]?.high || 'This is your strongest pillar — protect it.'}</span>
      </div>` : '';

    return rows + keepRow;
  }

  // ── Render everything ─────────────────────────────────────
  function renderScore(data) {
    const { total, pillars } = data;

    // Gauge SVG
    const gaugeSvg = document.getElementById('dsGaugeSvg');
    if (gaugeSvg) gaugeSvg.innerHTML = buildGaugeSVG(total);

    // Score band label under gauge
    const bandEl = document.getElementById('dsScoreBand');
    if (bandEl) {
      const bands = [
        { min: 80, label: '80–100 · Dominating',   cls: 'ds-band--green'  },
        { min: 60, label: '60–79 · Competitive',   cls: 'ds-band--amber'  },
        { min: 40, label: '40–59 · Building',       cls: 'ds-band--orange' },
        { min:  0, label: '0–39  · Struggling',     cls: 'ds-band--red'    },
      ];
      const band = bands.find(b => total >= b.min) || bands[bands.length - 1];
      bandEl.textContent  = band.label;
      bandEl.className    = `ds-score-band ${band.cls}`;
    }

    // Pillar bars
    const pillarsEl = document.getElementById('dsPillars');
    if (pillarsEl) pillarsEl.innerHTML = pillars.map(buildPillarBar).join('');

    // Key metrics strip
    const metricsEl = document.getElementById('dsMetricsGrid');
    if (metricsEl) {
      const p1   = pillars.find(p => p.key === 'seoClicks');
      const p2   = pillars.find(p => p.key === 'rankQuality');
      const p3   = pillars.find(p => p.key === 'momentum');
      const p4   = pillars.find(p => p.key === 'adEfficiency');
      const p5   = pillars.find(p => p.key === 'contentCTR');
      const meta = p4?.meta;

      const trendVal = p3
        ? (p3.prev > 0
            ? (p3.curr >= p3.prev ? '▲ ' : '▼ ') + Math.abs(Math.round((p3.curr - p3.prev) / p3.prev * 100)) + '%'
            : '—')
        : '—';

      const tiles = [
        buildMetricTile('GSC Clicks (28d)',   Math.round(p1?.clicks || 0).toLocaleString(), ''),
        buildMetricTile('Top-3 Keywords',      p2?.p1_3 ?? '—',   `${p2?.p4_10 ?? 0} more in top 10`),
        buildMetricTile('Traffic Trend',       trendVal,           'vs prior 28 days'),
        buildMetricTile('Avg Page CTR',        p5?.avgCtr ? p5.avgCtr.toFixed(1) + '%' : '—', `${p5?.pageCount ?? 0} pages`),
        meta
          ? buildMetricTile('CPL (7d)', meta.leads > 0 ? '$' + Math.round(meta.cpl) : '—', `${meta.leads} leads`)
          : buildMetricTile('Meta Ads', 'Not connected', 'add account ID in Settings'),
        meta && meta.spend > 0
          ? buildMetricTile('Ad Spend (7d)', '$' + Math.round(meta.spend), meta.roas > 0 ? meta.roas.toFixed(1) + 'x ROAS' : 'No ROAS data')
          : null,
      ].filter(Boolean);

      metricsEl.innerHTML = tiles.join('');
    }

    // Insights
    const insightsEl = document.getElementById('dsInsights');
    if (insightsEl) insightsEl.innerHTML = buildInsights(pillars);

    // Show UI
    setDsState('results');
    setText('dsLastUpdated', `Last scored: ${data.timestamp}`);
  }

  // ── State / helpers ───────────────────────────────────────
  function setDsState(state) {
    const ids = { loading: 'dsLoading', results: 'dsResults', error: 'dsError' };
    Object.entries(ids).forEach(([s, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (s === 'loading') el.style.display = state === s ? 'flex'  : 'none';
      else                 el.style.display = state === s ? 'block' : 'none';
    });
  }

  function showDsError(msg) {
    const el = document.getElementById('dsErrorMsg');
    if (el) el.textContent = msg;
    setDsState('error');
  }

  function setLoadingText(msg) {
    const el = document.querySelector('#dsLoading .ai-thinking__text');
    if (el) el.textContent = msg;
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── Persistence ───────────────────────────────────────────
  function saveScore(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function loadSavedScore() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
  }

  // ── Main: calculate ───────────────────────────────────────
  async function calculateScore() {
    if (!AppConfig.get('WINDSOR_API_KEY')) {
      showDsError('Windsor.ai API key required — add it in Settings.');
      return;
    }

    setDsState('loading');
    setLoadingText('Pulling GSC data from Windsor.ai…');

    const currDates = buildDates(0,  28); // last 28 days
    const prevDates = buildDates(28, 28); // previous 28 days
    const metaDates = buildDates(0,  7);  // last 7 days

    // ── Step 1: Three parallel GSC fetches ──────────────────
    let kwRows = [], currPageRows = [], prevPageRows = [];
    try {
      [kwRows, currPageRows, prevPageRows] = await Promise.all([
        fetchGSC(['query', 'clicks', 'impressions', 'position'], currDates),
        fetchGSC(['page',  'clicks', 'impressions', 'ctr'],      currDates),
        fetchGSC(['page',  'clicks', 'impressions'],              prevDates),
      ]);
    } catch (err) {
      showDsError(`Failed to load GSC data: ${err.message}`);
      return;
    }

    if (!currPageRows.length && !kwRows.length) {
      showDsError('No data returned from Windsor.ai. Check your API key and try again.');
      return;
    }

    // ── Step 2: Optional Meta fetch (non-fatal) ─────────────
    setLoadingText('Pulling Meta Ads data…');
    let metaRows = null;
    try {
      const cfg = AppConfig.load();
      if (cfg.META_ACCOUNT_ID) {
        const rows = await fetchMeta(metaDates);
        if (rows.length) metaRows = rows;
      }
    } catch (_) {
      metaRows = null; // silently skip — Meta not required
    }

    // ── Step 3: Score each pillar ────────────────────────────
    setLoadingText('Calculating your score…');
    const metaAgg = metaRows ? aggregateMeta(metaRows) : null;

    const pillars = [
      scoreSeoClicks(currPageRows),
      scoreRankingQuality(kwRows),
      scoreMomentum(currPageRows, prevPageRows),
      scoreAdEfficiency(metaAgg),
      scoreContentCTR(currPageRows),
    ];

    const total = pillars.reduce((s, p) => s + p.score, 0);

    const data = { total, pillars, meta: metaAgg, timestamp: timestampNow() };
    saveScore(data);
    renderScore(data);
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    document.getElementById('dsRunBtn')?.addEventListener('click', calculateScore);

    // Restore saved score — skip loading state on refresh
    const saved = loadSavedScore();
    if (saved?.total !== undefined && saved?.pillars?.length) {
      renderScore(saved);
    }
  }

  return { init, calculateScore };
})();
