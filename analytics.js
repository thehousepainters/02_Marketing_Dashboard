/* ============================================================
   analytics.js — Tab 3: Website Analytics & Daily Alerts
   Data source: Windsor.ai → googleanalytics4 connector
   Fetches: main (sessions/pages/devices), geo (city/country),
            landing pages — in parallel via Promise.allSettled
   ============================================================ */

'use strict';

const Analytics = (() => {
  const GA4_ACCOUNT = '360520506';
  const ENDPOINT    = 'https://connectors.windsor.ai/googleanalytics4';

  let currentRange = 7;
  let trendChart   = null;
  let nvChart      = null;

  // ── Windsor junk filter ────────────────────────────────────
  function cleanRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter(r => {
      const vals = Object.values(r).map(v => String(v).toLowerCase());
      return !vals.some(v => v.includes('license expired') || v.includes('windsor.ai/pricing'));
    });
  }

  // ── Date builder ───────────────────────────────────────────
  function buildDates(days) {
    const to = new Date();
    to.setDate(to.getDate() - 1);
    const from = new Date(to);
    from.setDate(from.getDate() - (days - 1));
    return { date_from: toISODate(from), date_to: toISODate(to) };
  }

  // ── Windsor fetches ────────────────────────────────────────
  async function fetchGA4Main(dates) {
    const key = AppConfig.get('WINDSOR_API_KEY');
    if (!key) throw new Error('Windsor.ai API key required — add in Settings.');
    const p = new URLSearchParams({
      api_key:  key,
      accounts: GA4_ACCOUNT,
      fields: [
        'date', 'sessions', 'active_users', 'bounce_rate',
        'average_session_duration', 'engaged_sessions',
        'screen_page_views',
        'default_channel_group', 'page_path', 'devicecategory', 'new_vs_returning',
        'conversions_quote_request', 'conversions_contact_form_submit',
        'conversions_phone_click',
      ].join(','),
      ...dates,
    });
    const res = await fetch(`${ENDPOINT}?${p}`);
    if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error(`GA4 ${res.status}: ${b}`); }
    const json = await res.json();
    return cleanRows(json.data || json.result || []);
  }

  async function fetchGA4Geo(dates) {
    const key = AppConfig.get('WINDSOR_API_KEY');
    if (!key) return [];
    const p = new URLSearchParams({
      api_key:  key,
      accounts: GA4_ACCOUNT,
      fields: [
        'city', 'country', 'sessions',
        'conversions_quote_request', 'conversions_contact_form_submit',
        'conversions_phone_click',
      ].join(','),
      ...dates,
    });
    const res = await fetch(`${ENDPOINT}?${p}`);
    if (!res.ok) return [];
    const json = await res.json();
    return cleanRows(json.data || json.result || []);
  }

  async function fetchGA4Landing(dates) {
    const key = AppConfig.get('WINDSOR_API_KEY');
    if (!key) return [];
    const p = new URLSearchParams({
      api_key:  key,
      accounts: GA4_ACCOUNT,
      fields: [
        'landing_page', 'sessions', 'bounce_rate',
        'conversions_quote_request', 'conversions_contact_form_submit',
        'conversions_phone_click',
      ].join(','),
      ...dates,
    });
    const res = await fetch(`${ENDPOINT}?${p}`);
    if (!res.ok) return [];
    const json = await res.json();
    return cleanRows(json.data || json.result || []);
  }

  // ── Aggregation helpers ────────────────────────────────────
  function calcTotals(rows) {
    let sessions = 0, users = 0, bounceSum = 0, durSum = 0;
    let convQuote = 0, convForm = 0, convPhone = 0;
    let newV = 0, returnV = 0, engagedSessions = 0, pageViews = 0;

    rows.forEach(r => {
      const s = r.sessions || 0;
      sessions        += s;
      users           += r.active_users || 0;
      bounceSum       += (r.bounce_rate || 0) * s;
      durSum          += (r.average_session_duration || 0) * s;
      convQuote       += r.conversions_quote_request || 0;
      convForm        += r.conversions_contact_form_submit || 0;
      convPhone       += r.conversions_phone_click || 0;
      engagedSessions += r.engaged_sessions || 0;
      pageViews       += r.screen_page_views || 0;
      if (r.new_vs_returning === 'new visitor')          newV    += s;
      else if (r.new_vs_returning === 'returning visitor') returnV += s;
    });

    const totalConv = convQuote + convForm + convPhone;
    return {
      sessions, users, pageViews,
      bounceRate:     sessions > 0 ? (bounceSum / sessions) * 100 : 0,
      avgDuration:    sessions > 0 ? durSum / sessions : 0,
      totalConversions: totalConv,
      convRate:       sessions > 0 ? (totalConv / sessions) * 100 : 0,
      engagementRate: sessions > 0 ? (engagedSessions / sessions) * 100 : 0,
      convQuote, convForm, convPhone,
      newV, returnV,
    };
  }

  function groupByDate(rows) {
    const map = {};
    rows.forEach(r => {
      const d = r.date || 'unknown';
      if (!map[d]) map[d] = { date: d, sessions: 0, conversions: 0 };
      map[d].sessions    += r.sessions || 0;
      map[d].conversions += (r.conversions_quote_request || 0)
                          + (r.conversions_contact_form_submit || 0)
                          + (r.conversions_phone_click || 0);
    });
    return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
  }

  function groupByChannel(rows) {
    const map = {};
    rows.forEach(r => {
      const ch = r.default_channel_group || 'Unknown';
      if (!map[ch]) map[ch] = { channel: ch, sessions: 0, conversions: 0 };
      map[ch].sessions    += r.sessions || 0;
      map[ch].conversions += (r.conversions_quote_request || 0)
                           + (r.conversions_contact_form_submit || 0)
                           + (r.conversions_phone_click || 0);
    });
    return Object.values(map).sort((a, b) => b.sessions - a.sessions);
  }

  function groupByPage(rows) {
    const map = {};
    rows.forEach(r => {
      const pg = r.page_path || '/';
      if (!map[pg]) map[pg] = { page_path: pg, sessions: 0, bSum: 0, dSum: 0, conversions: 0 };
      const s = r.sessions || 0;
      map[pg].sessions    += s;
      map[pg].bSum        += (r.bounce_rate || 0) * s;
      map[pg].dSum        += (r.average_session_duration || 0) * s;
      map[pg].conversions += (r.conversions_quote_request || 0)
                           + (r.conversions_contact_form_submit || 0)
                           + (r.conversions_phone_click || 0);
    });
    return Object.values(map)
      .map(pg => ({
        ...pg,
        bounceRate:  pg.sessions > 0 ? (pg.bSum / pg.sessions) * 100 : 0,
        avgDuration: pg.sessions > 0 ? pg.dSum / pg.sessions : 0,
        convRate:    pg.sessions > 0 ? (pg.conversions / pg.sessions) * 100 : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 25);
  }

  function groupByDevice(rows) {
    const map = {};
    rows.forEach(r => {
      const d = r.devicecategory || 'unknown';
      if (!map[d]) map[d] = { device: d, sessions: 0, conversions: 0 };
      map[d].sessions    += r.sessions || 0;
      map[d].conversions += (r.conversions_quote_request || 0)
                          + (r.conversions_contact_form_submit || 0)
                          + (r.conversions_phone_click || 0);
    });
    return Object.values(map).sort((a, b) => b.sessions - a.sessions);
  }

  function groupByCity(geoRows) {
    const map = {};
    geoRows.forEach(r => {
      const city    = r.city    || 'Unknown';
      const country = r.country || '';
      const key     = country ? `${city}, ${country}` : city;
      if (!map[key]) map[key] = { label: key, sessions: 0, conversions: 0 };
      map[key].sessions    += r.sessions || 0;
      map[key].conversions += (r.conversions_quote_request || 0)
                            + (r.conversions_contact_form_submit || 0)
                            + (r.conversions_phone_click || 0);
    });
    return Object.values(map).sort((a, b) => b.sessions - a.sessions).slice(0, 10);
  }

  function groupByLanding(landingRows) {
    const map = {};
    landingRows.forEach(r => {
      const pg = r.landing_page || r.landing_page_path || '/';
      if (!map[pg]) map[pg] = { page: pg, sessions: 0, bSum: 0, conversions: 0 };
      const s = r.sessions || 0;
      map[pg].sessions    += s;
      map[pg].bSum        += (r.bounce_rate || 0) * s;
      map[pg].conversions += (r.conversions_quote_request || 0)
                           + (r.conversions_contact_form_submit || 0)
                           + (r.conversions_phone_click || 0);
    });
    return Object.values(map)
      .map(pg => ({
        ...pg,
        bounceRate: pg.sessions > 0 ? (pg.bSum / pg.sessions) * 100 : 0,
        convRate:   pg.sessions > 0 ? (pg.conversions / pg.sessions) * 100 : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 15);
  }

  // ── Render: overview cards ─────────────────────────────────
  function renderOverview(t) {
    setText('anaSessions',    formatNumber(t.sessions));
    setText('anaUsers',       formatNumber(t.users));
    setText('anaPageViews',   formatNumber(t.pageViews));
    setText('anaDuration',    fmtDuration(t.avgDuration));
    setText('anaBounce',      t.bounceRate.toFixed(1) + '%');
    setText('anaEngagement',  t.engagementRate.toFixed(1) + '%');
    setText('anaConversions', formatNumber(t.totalConversions));
    setText('anaConvRate',    t.convRate.toFixed(2) + '%');

    const nvr = t.newV + t.returnV;
    if (nvr > 0) {
      setText('anaNvR',
        `${Math.round(t.newV / nvr * 100)}% new · ${Math.round(t.returnV / nvr * 100)}% returning`);
    }
    setText('anaConvSub',
      `${formatNumber(t.convForm)} forms · ${formatNumber(t.convPhone)} calls · ${formatNumber(t.convQuote)} quotes`);
  }

  // ── Render: sessions trend line chart ──────────────────────
  function renderTrend(daily) {
    const canvas = document.getElementById('anaTrendChart');
    if (!canvas) return;
    const labels   = daily.map(d => { const [, m, day] = d.date.split('-'); return `${day}/${m}`; });
    const sessData = daily.map(d => d.sessions);
    const convData = daily.map(d => d.conversions);

    if (trendChart) trendChart.destroy();
    trendChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Sessions',
            data: sessData,
            borderColor: '#465fff',
            backgroundColor: 'rgba(70,95,255,0.08)',
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            yAxisID: 'y',
          },
          {
            label: 'Conversions',
            data: convData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.08)',
            fill: false,
            tension: 0.4,
            pointRadius: 3,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top' } },
        scales: {
          y:  { position: 'left',  beginAtZero: true, grid: { color: '#f0f0f0' }, ticks: { precision: 0 } },
          y1: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { precision: 0 } },
        },
      },
    });
  }

  // ── Render: new vs returning doughnut ──────────────────────
  function renderNewVsReturning(t) {
    const canvas = document.getElementById('anaNewVsChart');
    if (!canvas) return;
    const total = t.newV + t.returnV;
    if (!total) return;

    if (nvChart) nvChart.destroy();
    nvChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['New Visitors', 'Returning'],
        datasets: [{
          data: [t.newV, t.returnV],
          backgroundColor: ['#465fff', '#10b981'],
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = total > 0 ? (ctx.raw / total * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatNumber(ctx.raw)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ── Render: alerts ─────────────────────────────────────────
  function renderAlerts(pages, totals) {
    const panel = document.getElementById('anaAlertPanel');
    const list  = document.getElementById('anaAlertList');
    if (!panel || !list) return;

    const critical = [];
    const warnings = [];

    if (totals.totalConversions === 0 && totals.sessions > 20) {
      critical.push(
        `<div class="alert-item alert-item--critical">
          <span class="alert-bullet">🔴</span>
          <strong>Zero conversions</strong> across ${formatNumber(totals.sessions)} sessions —
          check contact forms and phone call tracking.
        </div>`
      );
    }

    if (totals.engagementRate < 40 && totals.sessions > 20) {
      warnings.push(
        `<div class="alert-item">
          <span class="alert-bullet">●</span>
          <strong>Low engagement rate: ${totals.engagementRate.toFixed(1)}%</strong> —
          most visitors leaving without interacting. Review page content and load speed.
        </div>`
      );
    }

    pages.forEach(pg => {
      if (pg.sessions >= 10 && pg.convRate < 2) {
        warnings.push(
          `<div class="alert-item">
            <span class="alert-bullet">●</span>
            <strong>${esc(pg.page_path)}</strong> — ${formatNumber(pg.sessions)} sessions,
            only <strong>${pg.convRate.toFixed(1)}% conversion rate</strong>
          </div>`
        );
      }
      if (pg.sessions >= 5 && pg.bounceRate > 70) {
        warnings.push(
          `<div class="alert-item">
            <span class="alert-bullet">●</span>
            <strong>${esc(pg.page_path)}</strong> — <strong>${pg.bounceRate.toFixed(0)}% bounce rate</strong>
            (${formatNumber(pg.sessions)} sessions)
          </div>`
        );
      }
    });

    const total = critical.length + warnings.length;
    if (!total) { panel.style.display = 'none'; return; }

    const parts = [];
    if (critical.length) parts.push(`${critical.length} critical`);
    if (warnings.length) parts.push(`${warnings.length} page issue${warnings.length > 1 ? 's' : ''}`);
    const summary = parts.join(' · ');

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

    list.innerHTML = [...critical, ...warnings].join('');
    list.style.display = 'none';
    panel.style.display = 'block';
  }

  // ── Render: traffic channels ───────────────────────────────
  function renderChannels(channels, totalSessions) {
    const el = document.getElementById('anaChannelsBody');
    if (!el) return;
    const channelColors = {
      'Organic Search': '#10b981',
      'Paid Search':    '#3b82f6',
      'Direct':         '#8b5cf6',
      'Referral':       '#f59e0b',
      'Social':         '#ec4899',
      'Email':          '#14b8a6',
      'Unassigned':     '#9ca3af',
    };
    el.innerHTML = channels.map(ch => {
      const pct      = totalSessions > 0 ? (ch.sessions / totalSessions * 100) : 0;
      const convRate = ch.sessions > 0 ? (ch.conversions / ch.sessions * 100).toFixed(1) : '0.0';
      const color    = channelColors[ch.channel] || '#6b7280';
      return `
        <div class="channel-row">
          <div class="channel-name">${esc(ch.channel)}</div>
          <div class="channel-bar-wrap">
            <div class="channel-bar" style="width:${pct.toFixed(1)}%;background:${color}"></div>
          </div>
          <div class="channel-stat">${formatNumber(ch.sessions)}</div>
          <div class="channel-stat text-muted">${pct.toFixed(1)}%</div>
          <div class="channel-stat">${convRate}% conv.</div>
        </div>
      `;
    }).join('');
  }

  // ── Render: device breakdown ───────────────────────────────
  function renderDevices(devices) {
    const el = document.getElementById('anaDevicesBody');
    if (!el) return;
    const total = devices.reduce((s, d) => s + d.sessions, 0);
    const icons = { mobile: '📱', desktop: '💻', tablet: '📟' };
    el.innerHTML = devices.map(d => {
      const pct      = total > 0 ? (d.sessions / total * 100) : 0;
      const convRate = d.sessions > 0 ? (d.conversions / d.sessions * 100).toFixed(1) : '0.0';
      return `
        <div class="device-row">
          <span class="device-icon">${icons[d.device] || '🖥️'}</span>
          <span class="device-name">${esc(d.device)}</span>
          <div class="device-bar-wrap">
            <div class="device-bar" style="width:${pct.toFixed(0)}%"></div>
          </div>
          <span class="device-sessions">${formatNumber(d.sessions)} sessions</span>
          <span class="device-pct">${pct.toFixed(0)}%</span>
          <span class="device-conv">${convRate}% conv.</span>
        </div>
      `;
    }).join('');
  }

  // ── Render: geographic table ───────────────────────────────
  function renderGeo(cities, totalSessions) {
    const el = document.getElementById('anaGeoBody');
    if (!el) return;
    if (!cities.length) {
      el.innerHTML = '<tr><td colspan="4" class="table-empty">No geographic data available</td></tr>';
      return;
    }
    const maxSess = cities[0]?.sessions || 1;
    el.innerHTML = cities.map(c => {
      const pct      = totalSessions > 0 ? (c.sessions / totalSessions * 100).toFixed(1) : '0.0';
      const convRate = c.sessions > 0 ? (c.conversions / c.sessions * 100).toFixed(1) : '0.0';
      const barW     = (c.sessions / maxSess * 100).toFixed(0);
      return `
        <tr>
          <td>${esc(c.label)}</td>
          <td class="td-number">${formatNumber(c.sessions)}</td>
          <td class="td-number">
            <div style="display:flex;align-items:center;gap:0.5rem">
              <div style="flex:1;height:6px;background:#f0f0f0;border-radius:3px">
                <div style="width:${barW}%;height:100%;background:#465fff;border-radius:3px"></div>
              </div>
              <span style="min-width:3rem;text-align:right">${pct}%</span>
            </div>
          </td>
          <td class="td-number">${convRate}%</td>
        </tr>
      `;
    }).join('');
  }

  // ── Render: top pages table ────────────────────────────────
  function renderPages(pages) {
    const tbody = document.getElementById('anaPagesTableBody');
    if (!tbody) return;
    tbody.innerHTML = pages.map(pg => {
      const lowConv    = pg.sessions >= 10 && pg.convRate < 2;
      const highBounce = pg.sessions >= 5  && pg.bounceRate > 70;
      const rowCls     = lowConv ? 'row-red' : (highBounce ? 'row-amber' : '');
      return `
        <tr class="${rowCls}">
          <td class="td-url">${esc(pg.page_path)}</td>
          <td class="td-number">${formatNumber(pg.sessions)}</td>
          <td class="td-number ${lowConv ? 'text-red' : ''}">${pg.convRate.toFixed(1)}%</td>
          <td class="td-number ${highBounce ? 'text-amber' : ''}">${pg.bounceRate.toFixed(0)}%</td>
          <td class="td-number">${fmtDuration(pg.avgDuration)}</td>
          <td class="td-number">${formatNumber(pg.conversions)}</td>
        </tr>
      `;
    }).join('');
  }

  // ── Render: top landing pages ──────────────────────────────
  function renderLandingPages(pages) {
    const tbody = document.getElementById('anaLandingBody');
    if (!tbody) return;
    if (!pages.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No landing page data</td></tr>';
      return;
    }
    tbody.innerHTML = pages.map(pg => {
      const highBounce = pg.bounceRate > 70;
      const lowConv    = pg.sessions >= 10 && pg.convRate < 2;
      const rowCls     = lowConv ? 'row-red' : (highBounce ? 'row-amber' : '');
      return `
        <tr class="${rowCls}">
          <td class="td-url">${esc(pg.page)}</td>
          <td class="td-number">${formatNumber(pg.sessions)}</td>
          <td class="td-number ${highBounce ? 'text-amber' : ''}">${pg.bounceRate.toFixed(0)}%</td>
          <td class="td-number ${lowConv ? 'text-red' : ''}">${pg.convRate.toFixed(1)}%</td>
          <td class="td-number">${formatNumber(pg.conversions)}</td>
        </tr>
      `;
    }).join('');
  }

  // ── Main load ──────────────────────────────────────────────
  async function loadAnalytics() {
    showLoading(true);
    try {
      const dates = buildDates(currentRange);
      const [mainRes, geoRes, landRes] = await Promise.allSettled([
        fetchGA4Main(dates),
        fetchGA4Geo(dates),
        fetchGA4Landing(dates),
      ]);

      const rows     = mainRes.status  === 'fulfilled' ? mainRes.value  : [];
      const geoRows  = geoRes.status   === 'fulfilled' ? geoRes.value   : [];
      const landRows = landRes.status  === 'fulfilled' ? landRes.value  : [];

      if (mainRes.status === 'rejected') {
        console.error('[Analytics] main fetch failed:', mainRes.reason);
        showToast('Analytics Error: ' + mainRes.reason.message, 5000);
      }
      if (geoRes.status  === 'rejected') console.warn('[Analytics] geo fetch:', geoRes.reason);
      if (landRes.status === 'rejected') console.warn('[Analytics] landing fetch:', landRes.reason);

      const totals   = calcTotals(rows);
      const daily    = groupByDate(rows);
      const channels = groupByChannel(rows);
      const pages    = groupByPage(rows);
      const devices  = groupByDevice(rows);
      const cities   = groupByCity(geoRows);
      const landings = groupByLanding(landRows);

      renderOverview(totals);
      renderAlerts(pages, totals);
      renderTrend(daily);
      renderNewVsReturning(totals);
      renderChannels(channels, totals.sessions);
      renderDevices(devices);
      renderGeo(cities, totals.sessions);
      renderPages(pages);
      renderLandingPages(landings);

      setText('anaLastUpdated', `Last updated: ${timestampNow()}`);
    } catch (err) {
      showToast('Analytics Error: ' + err.message, 5000);
      console.error('[Analytics]', err);
    } finally {
      showLoading(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function fmtDuration(secs) {
    if (!secs || secs < 1) return '0s';
    const m = Math.floor(secs / 60);
    const s = Math.round(secs % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function showLoading(on) {
    const spin    = document.getElementById('anaLoading');
    const content = document.getElementById('anaContent');
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

  // ── Init ───────────────────────────────────────────────────
  function init() {
    document.getElementById('analyticsDateSelector')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      document.querySelectorAll('#analyticsDateSelector .date-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = parseInt(btn.dataset.range) || 7;
      loadAnalytics();
    });

    document.getElementById('analyticsRefreshBtn')?.addEventListener('click', loadAnalytics);

    if (AppConfig.get('WINDSOR_API_KEY')) loadAnalytics();
  }

  return { init, loadAnalytics };
})();
