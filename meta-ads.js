/* ============================================================
   meta-ads.js — Tab 1 (Meta Ads Performance) + Tab 6 (War Room)
   Data source: Windsor.ai
   AI analysis: Claude API (War Room only)
   ============================================================ */

'use strict';

const MetaAds = (() => {

  // ---- State ----
  let currentRange = '7';
  let allAdsData   = [];
  let spendLeadsChart, cplChart, roasChart;
  let tableSortKey = 'spend';
  let tableSortDir = 'desc';

  // ---- War Room system prompt ----
  const WAR_ROOM_SYSTEM_PROMPT = `You are a brutally honest Facebook Ads analyst. No marketing jargon. No fluff. You work for The House Painters, a house painting company in Auckland, New Zealand. Your only job is to make their ads profitable and stop them wasting money.

Service rules:
- Exterior painting, weatherboard painting, and paint stripping can have unlimited budget.
- Interior painting can use up to 20% of total ad spend.
- Roof painting can only appear inside multi-service carousel ads. It must not have standalone campaigns or ad sets.

For every single ad in the data, give ONE clear verdict: STOP, KEEP, or TEST.
- STOP: The ad is burning money. Say exactly why in plain English (e.g. "CPL is $140, no leads in 7 days, frequency too high"). Tell them to kill it today.
- KEEP: The ad is performing well. Say exactly why (good CPL, solid CTR, consistent leads). Say what must NOT be changed.
- TEST: The ad has potential but needs changes. Say exactly what to change (headline, image, audience, budget).

After reviewing all ads, propose 2-3 NEW AD CONCEPTS focused on exterior painting, weatherboard painting, and paint stripping. For each new concept provide a JSON object with keys: headline, primary_text, description, image_description, audience, starting_budget, success_target.

Respond with ONLY valid JSON in this exact structure:
{
  "verdicts": [
    {
      "ad_name": "exact ad name from data",
      "campaign_name": "campaign name",
      "verdict": "STOP" | "KEEP" | "TEST",
      "reason": "plain English explanation",
      "spend": 0,
      "leads": 0,
      "cpl": 0,
      "ctr": 0,
      "frequency": 0,
      "roas": 0
    }
  ],
  "new_concepts": [
    {
      "headline": "under 40 chars",
      "primary_text": "2-3 sentences in plain NZ English",
      "description": "one short line",
      "image_description": "describe exactly what the image should show",
      "audience": "precise targeting details",
      "starting_budget": "e.g. $20/day",
      "success_target": "e.g. CPL under $60 within 7 days"
    }
  ]
}`;

  // ============================================================
  // WINDSOR.AI FETCH
  // ============================================================
  async function fetchWindsorData(dateFrom, dateTo) {
    const cfg = AppConfig.load();
    if (!cfg.WINDSOR_API_KEY || !cfg.META_ACCOUNT_ID) {
      throw new Error('Windsor.ai API key and Meta Account ID are required. Add them in Settings.');
    }

    const fields = [
      'date', 'ad_name', 'campaign_name', 'spend', 'leads',
      'cost_per_lead', 'purchase_roas', 'clicks', 'ctr',
      'impressions', 'frequency',
    ].join(',');

    const params = new URLSearchParams({
      api_key:   cfg.WINDSOR_API_KEY,
      connector: 'facebook',
      accounts:  cfg.META_ACCOUNT_ID,
      fields,
      date_from: dateFrom,
      date_to:   dateTo,
    });

    const res = await fetch(`https://connectors.windsor.ai/facebook?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Windsor.ai error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    // Windsor returns { data: [...] } or an array
    return Array.isArray(json) ? json : (json.data || []);
  }

  // Normalise a row from Windsor into consistent field names
  function normaliseRow(row) {
    return {
      date:          row.date || '',
      ad_name:       row.ad_name || row.adName || '—',
      campaign_name: row.campaign_name || row.campaignName || '—',
      spend:         parseFloat(row.spend) || 0,
      leads:         parseInt(row.leads) || 0,
      cpl:           parseFloat(row.cost_per_lead || row.cpl) || 0,
      roas:          parseFloat(row.purchase_roas || row.roas) || 0,
      clicks:        parseInt(row.clicks) || 0,
      ctr:           parseFloat(row.ctr) || 0,
      impressions:   parseInt(row.impressions) || 0,
      frequency:     parseFloat(row.frequency) || 0,
    };
  }

  // Aggregate rows by ad (sum spend/leads/clicks/impressions; avg CPL/CTR/freq/ROAS)
  function aggregateByAd(rows) {
    const map = {};
    rows.forEach(row => {
      const key = `${row.campaign_name}|||${row.ad_name}`;
      if (!map[key]) {
        map[key] = { ...row, _rows: 1 };
      } else {
        map[key].spend       += row.spend;
        map[key].leads       += row.leads;
        map[key].clicks      += row.clicks;
        map[key].impressions += row.impressions;
        map[key]._rows       += 1;
      }
    });
    // Recalculate derived metrics
    return Object.values(map).map(ad => {
      ad.cpl  = ad.leads > 0 ? ad.spend / ad.leads : 0;
      ad.ctr  = ad.impressions > 0 ? (ad.clicks / ad.impressions) * 100 : 0;
      // Average ROAS and frequency across days
      const subset = rows.filter(r =>
        r.campaign_name === ad.campaign_name && r.ad_name === ad.ad_name
      );
      ad.roas      = avg(subset.map(r => r.roas));
      ad.frequency = avg(subset.map(r => r.frequency));
      return ad;
    });
  }

  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  // Group by date for time-series charts
  function groupByDate(rows) {
    const map = {};
    rows.forEach(row => {
      if (!map[row.date]) map[row.date] = { spend: 0, leads: 0 };
      map[row.date].spend += row.spend;
      map[row.date].leads += row.leads;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));
  }

  // Group by campaign for bar charts
  function groupByCampaign(ads) {
    const map = {};
    ads.forEach(ad => {
      if (!map[ad.campaign_name]) map[ad.campaign_name] = { spend: 0, leads: 0, roas_sum: 0, count: 0 };
      map[ad.campaign_name].spend    += ad.spend;
      map[ad.campaign_name].leads    += ad.leads;
      map[ad.campaign_name].roas_sum += ad.roas;
      map[ad.campaign_name].count    += 1;
    });
    return Object.entries(map).map(([name, v]) => ({
      campaign_name: name,
      spend: v.spend,
      leads: v.leads,
      cpl:   v.leads > 0 ? v.spend / v.leads : 0,
      roas:  v.count > 0 ? v.roas_sum / v.count : 0,
    }));
  }

  // ============================================================
  // ALERTS
  // ============================================================
  function buildAlerts(ads) {
    const cfg = AppConfig.load();
    const cplThresh  = cfg.CPL_ALERT_THRESHOLD        || 80;
    const freqThresh = cfg.FREQUENCY_ALERT_THRESHOLD  || 3.5;
    const spendThresh= cfg.SPEND_ZERO_LEAD_THRESHOLD  || 20;

    const alerts = [];

    ads.forEach(ad => {
      if (ad.cpl > cplThresh && ad.leads > 0) {
        alerts.push({
          type: 'red',
          msg: `CPL alert: "${ad.ad_name}" — CPL is ${formatNZD(ad.cpl)} (threshold: ${formatNZD(cplThresh)})`
        });
      }
      if (ad.frequency > freqThresh) {
        alerts.push({
          type: 'amber',
          msg: `High frequency: "${ad.ad_name}" — frequency ${ad.frequency.toFixed(1)} (threshold: ${freqThresh})`
        });
      }
      if (ad.spend > spendThresh && ad.leads === 0) {
        alerts.push({
          type: 'red',
          msg: `Spending with 0 leads: "${ad.ad_name}" — spent ${formatNZD(ad.spend)} with zero leads`
        });
      }
    });

    return alerts;
  }

  // ============================================================
  // RENDER: SUMMARY CARDS
  // ============================================================
  function renderSummaryCards(ads) {
    const totalSpend  = ads.reduce((s, a) => s + a.spend, 0);
    const totalLeads  = ads.reduce((s, a) => s + a.leads, 0);
    const totalClicks = ads.reduce((s, a) => s + a.clicks, 0);
    const totalImpr   = ads.reduce((s, a) => s + a.impressions, 0);
    const cpl         = totalLeads > 0 ? totalSpend / totalLeads : 0;
    const avgRoas     = avg(ads.map(a => a.roas));
    const cpc         = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const ctr         = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;

    const cfg = AppConfig.load();

    setText('metaTotalSpend', formatNZD(totalSpend));
    setText('metaTotalLeads', formatNumber(totalLeads));
    setText('metaCPL',        formatNZD(cpl));
    setText('metaROAS',       avgRoas > 0 ? avgRoas.toFixed(2) + 'x' : '—');
    setText('metaCPC',        formatNZD(cpc, 2));
    setText('metaCTR',        formatPercent(ctr));

    // Colour-code CPL
    const cplEl = document.getElementById('metaCPL');
    if (cplEl) {
      cplEl.className = 'metric-value ' + (
        cpl > cfg.CPL_ALERT_THRESHOLD ? 'metric-value--red' :
        cpl < cfg.CPL_ALERT_THRESHOLD * 0.7 ? 'metric-value--green' : ''
      );
    }
  }

  // ============================================================
  // RENDER: CHARTS
  // ============================================================
  function renderCharts(rows, ads) {
    const byCampaign = groupByCampaign(ads);
    const byDate     = groupByDate(rows);

    // Destroy old charts
    [spendLeadsChart, cplChart, roasChart].forEach(c => c && c.destroy());

    // Spend vs Leads line chart
    const spendLeadsCtx = document.getElementById('metaSpendLeadsChart');
    if (spendLeadsCtx) {
      spendLeadsChart = new Chart(spendLeadsCtx, {
        type: 'line',
        data: {
          labels: byDate.map(d => formatShortDate(d.date)),
          datasets: [
            {
              label: 'Spend (NZD)',
              data: byDate.map(d => d.spend),
              borderColor: '#111827',
              backgroundColor: 'rgba(17,24,39,0.05)',
              fill: true,
              tension: 0.3,
              pointRadius: 3,
              yAxisID: 'ySpend',
            },
            {
              label: 'Leads',
              data: byDate.map(d => d.leads),
              borderColor: '#10b981',
              backgroundColor: 'rgba(16,185,129,0.08)',
              fill: true,
              tension: 0.3,
              pointRadius: 3,
              yAxisID: 'yLeads',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, position: 'top' } },
          scales: {
            ySpend: { type: 'linear', position: 'left', grid: { color: '#f1f5f9' } },
            yLeads: { type: 'linear', position: 'right', grid: { drawOnChartArea: false } },
          },
        },
      });
    }

    // CPL by Campaign bar chart
    const cplCtx = document.getElementById('metaCPLChart');
    if (cplCtx) {
      const cfg = AppConfig.load();
      cplChart = new Chart(cplCtx, {
        type: 'bar',
        data: {
          labels: byCampaign.map(c => shortLabel(c.campaign_name, 20)),
          datasets: [{
            label: 'CPL (NZD)',
            data: byCampaign.map(c => c.cpl),
            backgroundColor: byCampaign.map(c =>
              c.cpl > cfg.CPL_ALERT_THRESHOLD ? '#ef4444' :
              c.cpl < cfg.CPL_ALERT_THRESHOLD * 0.7 ? '#10b981' : '#f59e0b'
            ),
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ' $' + ctx.raw.toFixed(2) } },
          },
          scales: {
            y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => '$' + v } },
          },
        },
      });
    }

    // ROAS by Campaign bar chart
    const roasCtx = document.getElementById('metaROASChart');
    if (roasCtx) {
      roasChart = new Chart(roasCtx, {
        type: 'bar',
        data: {
          labels: byCampaign.map(c => shortLabel(c.campaign_name, 20)),
          datasets: [{
            label: 'ROAS',
            data: byCampaign.map(c => c.roas),
            backgroundColor: byCampaign.map(c =>
              c.roas >= 3 ? '#10b981' : c.roas >= 1 ? '#f59e0b' : '#ef4444'
            ),
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ' ' + ctx.raw.toFixed(2) + 'x' } },
          },
          scales: { y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => v + 'x' } } },
        },
      });
    }
  }

  // ============================================================
  // RENDER: TABLE
  // ============================================================
  function renderTable(ads) {
    const tbody = document.getElementById('metaAdsTableBody');
    const cfg   = AppConfig.load();

    if (!ads.length) {
      tbody.innerHTML = '<tr><td colspan="10" class="table-empty">No ad data for this period.</td></tr>';
      setText('metaAdCount', '0 ads');
      return;
    }

    // Sort
    const sorted = [...ads].sort((a, b) => {
      const av = a[tableSortKey] ?? 0;
      const bv = b[tableSortKey] ?? 0;
      if (typeof av === 'string') return tableSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return tableSortDir === 'asc' ? av - bv : bv - av;
    });

    tbody.innerHTML = sorted.map(ad => {
      const rowClass =
        (ad.cpl > cfg.CPL_ALERT_THRESHOLD && ad.leads > 0) ||
        (ad.spend > cfg.SPEND_ZERO_LEAD_THRESHOLD && ad.leads === 0) ? 'row--red' :
        ad.frequency > cfg.FREQUENCY_ALERT_THRESHOLD ? 'row--amber' : '';

      return `
        <tr class="${rowClass}">
          <td title="${ad.ad_name}">${shortLabel(ad.ad_name, 30)}</td>
          <td title="${ad.campaign_name}">${shortLabel(ad.campaign_name, 25)}</td>
          <td>${formatNZD(ad.spend)}</td>
          <td>${ad.leads}</td>
          <td class="${ad.cpl > cfg.CPL_ALERT_THRESHOLD && ad.leads > 0 ? 'text-red' : ''}">${ad.leads > 0 ? formatNZD(ad.cpl) : '—'}</td>
          <td>${formatPercent(ad.ctr)}</td>
          <td>${formatNumber(ad.impressions)}</td>
          <td class="${ad.frequency > cfg.FREQUENCY_ALERT_THRESHOLD ? 'text-amber' : ''}">${ad.frequency.toFixed(1)}</td>
          <td>${ad.roas > 0 ? ad.roas.toFixed(2) + 'x' : '—'}</td>
          <td><span class="status-badge status-badge--active">Active</span></td>
        </tr>
      `;
    }).join('');

    setText('metaAdCount', `${ads.length} ad${ads.length !== 1 ? 's' : ''}`);
  }

  // ============================================================
  // RENDER: ALERT PANEL
  // ============================================================
  function renderAlerts(alerts) {
    const panel = document.getElementById('metaAlertPanel');
    const list  = document.getElementById('metaAlertList');
    if (!alerts.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    list.innerHTML = alerts.map(a => `
      <div class="alert-item">
        <div class="alert-item__dot alert-item__dot--${a.type}"></div>
        <span>${a.msg}</span>
      </div>
    `).join('');
  }

  // ============================================================
  // EXPORT CSV
  // ============================================================
  function exportCSV(ads) {
    const headers = ['Ad Name','Campaign','Spend','Leads','CPL','CTR','Impressions','Frequency','ROAS'];
    const rows = ads.map(ad => [
      `"${ad.ad_name}"`,
      `"${ad.campaign_name}"`,
      ad.spend.toFixed(2),
      ad.leads,
      ad.cpl.toFixed(2),
      ad.ctr.toFixed(2),
      ad.impressions,
      ad.frequency.toFixed(2),
      ad.roas.toFixed(2),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `meta-ads-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // LOAD & RENDER (Tab 1)
  // ============================================================
  async function loadMetaAds() {
    const { from, to } = getDateRange(currentRange);
    const refreshBtn = document.getElementById('metaRefreshBtn');
    refreshBtn.textContent = '↻ Loading…';
    refreshBtn.disabled = true;

    try {
      const raw  = await fetchWindsorData(from, to);
      const rows = raw.map(normaliseRow);
      allAdsData = aggregateByAd(rows);

      renderSummaryCards(allAdsData);
      renderCharts(rows, allAdsData);
      renderTable(allAdsData);
      renderAlerts(buildAlerts(allAdsData));
      setText('metaLastUpdated', `Last updated: ${timestampNow()}`);
    } catch (err) {
      showToast('Error: ' + err.message, 6000);
      console.error(err);
    } finally {
      refreshBtn.textContent = '↻ Refresh';
      refreshBtn.disabled = false;
    }
  }

  // ============================================================
  // WAR ROOM (Tab 6)
  // ============================================================
  async function runWarRoom() {
    const cfg = AppConfig.load();
    if (!cfg.WINDSOR_API_KEY || !cfg.META_ACCOUNT_ID) {
      showWarRoomError('Windsor.ai API key and Meta Account ID are required. Add them in Settings.');
      return;
    }
    if (!cfg.CLAUDE_API_KEY) {
      showWarRoomError('Claude API key is required for War Room analysis. Add it in Settings.');
      return;
    }

    showWarRoomState('loading');

    try {
      // Pull yesterday's data
      const { from, to } = getDateRange('yesterday');
      const raw  = await fetchWindsorData(from, to);
      const rows = raw.map(normaliseRow);
      const ads  = aggregateByAd(rows);

      if (!ads.length) {
        showWarRoomError('No ad data found for yesterday. Try a different date or check your account ID.');
        return;
      }

      // Call Claude
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         cfg.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model:      'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          system:     WAR_ROOM_SYSTEM_PROMPT,
          messages: [{
            role:    'user',
            content: `Here is yesterday's ad data for The House Painters. Analyse every ad and respond with the required JSON:\n\n${JSON.stringify(ads, null, 2)}`,
          }],
        }),
      });

      if (!claudeRes.ok) {
        const text = await claudeRes.text();
        throw new Error(`Claude API error ${claudeRes.status}: ${text.slice(0, 300)}`);
      }

      const claudeJson = await claudeRes.json();
      const content    = claudeJson.content?.[0]?.text || '';

      // Extract JSON from Claude response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Claude returned unexpected format. Check the console for details.');

      const analysis = JSON.parse(jsonMatch[0]);
      renderWarRoom(analysis);
      setText('warRoomLastUpdated', `Last analysed: ${timestampNow()}`);

    } catch (err) {
      showWarRoomError(err.message);
      console.error(err);
    }
  }

  function showWarRoomState(state) {
    document.getElementById('warRoomIdle').style.display    = state === 'idle'    ? 'block' : 'none';
    document.getElementById('warRoomLoading').style.display = state === 'loading' ? 'block' : 'none';
    document.getElementById('warRoomResults').style.display = state === 'results' ? 'block' : 'none';
    document.getElementById('warRoomError').style.display   = state === 'error'   ? 'block' : 'none';
  }

  function showWarRoomError(msg) {
    document.getElementById('warRoomErrorMsg').textContent = msg;
    showWarRoomState('error');
  }

  function renderWarRoom(analysis) {
    showWarRoomState('results');
    const verdicts  = analysis.verdicts  || [];
    const concepts  = analysis.new_concepts || [];

    // Summary badges
    const stops = verdicts.filter(v => v.verdict === 'STOP').length;
    const keeps = verdicts.filter(v => v.verdict === 'KEEP').length;
    const tests = verdicts.filter(v => v.verdict === 'TEST').length;

    document.getElementById('warRoomSummary').innerHTML = `
      <div class="war-room-summary-badge war-room-summary-badge--stop">
        <span class="war-room-summary-badge__count">${stops}</span> STOP
      </div>
      <div class="war-room-summary-badge war-room-summary-badge--keep">
        <span class="war-room-summary-badge__count">${keeps}</span> KEEP
      </div>
      <div class="war-room-summary-badge war-room-summary-badge--test">
        <span class="war-room-summary-badge__count">${tests}</span> TEST
      </div>
    `;

    // Sort: STOP first, then TEST, then KEEP
    const order = { STOP: 0, TEST: 1, KEEP: 2 };
    verdicts.sort((a, b) => (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3));

    // Verdict cards
    document.getElementById('warRoomCards').innerHTML = verdicts.map(v => `
      <div class="verdict-card">
        <div class="verdict-card__header">
          <span class="verdict-card__name" title="${v.ad_name}">${v.ad_name}</span>
          <span class="verdict-badge verdict-badge--${v.verdict.toLowerCase()}">${v.verdict}</span>
        </div>
        <div class="verdict-card__metrics">
          <div class="verdict-metric">
            <span class="verdict-metric__val">${formatNZD(v.spend)}</span>
            <span class="verdict-metric__lbl">Spend</span>
          </div>
          <div class="verdict-metric">
            <span class="verdict-metric__val">${v.leads ?? 0}</span>
            <span class="verdict-metric__lbl">Leads</span>
          </div>
          <div class="verdict-metric">
            <span class="verdict-metric__val">${v.leads > 0 ? formatNZD(v.cpl) : '—'}</span>
            <span class="verdict-metric__lbl">CPL</span>
          </div>
          <div class="verdict-metric">
            <span class="verdict-metric__val">${formatPercent(v.ctr)}</span>
            <span class="verdict-metric__lbl">CTR</span>
          </div>
          <div class="verdict-metric">
            <span class="verdict-metric__val">${(v.frequency ?? 0).toFixed(1)}</span>
            <span class="verdict-metric__lbl">Freq</span>
          </div>
          <div class="verdict-metric">
            <span class="verdict-metric__val">${v.roas > 0 ? v.roas.toFixed(1) + 'x' : '—'}</span>
            <span class="verdict-metric__lbl">ROAS</span>
          </div>
        </div>
        <div class="verdict-card__reason">${v.reason}</div>
      </div>
    `).join('');

    // Concept cards
    document.getElementById('warRoomConcepts').innerHTML = concepts.map((c, i) => `
      <div class="concept-card">
        <div class="concept-card__header">
          <span class="concept-card__num">${i + 1}</span>
          <span class="concept-card__title">${c.headline}</span>
        </div>
        <div class="concept-card__body">
          <div class="concept-field">
            <div class="concept-field__label">Primary Text</div>
            <div class="concept-field__value">${c.primary_text}</div>
          </div>
          <div class="concept-field">
            <div class="concept-field__label">Description</div>
            <div class="concept-field__value">${c.description}</div>
          </div>
          <div class="concept-field">
            <div class="concept-field__label">Image</div>
            <div class="concept-field__value">${c.image_description}</div>
          </div>
          <div class="concept-field">
            <div class="concept-field__label">Audience</div>
            <div class="concept-field__value">${c.audience}</div>
          </div>
          <div style="display:flex;gap:1rem;margin-top:0.5rem">
            <div class="concept-field" style="flex:1">
              <div class="concept-field__label">Starting Budget</div>
              <div class="concept-field__value">${c.starting_budget}</div>
            </div>
            <div class="concept-field" style="flex:1">
              <div class="concept-field__label">Success Target</div>
              <div class="concept-field__value">${c.success_target}</div>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  }

  // ============================================================
  // TABLE SORT
  // ============================================================
  function initTableSort() {
    document.querySelectorAll('#metaAdsTable th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (tableSortKey === key) {
          tableSortDir = tableSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          tableSortKey = key;
          tableSortDir = 'desc';
        }
        renderTable(allAdsData);
      });
    });
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function formatShortDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' });
  }

  function shortLabel(str, maxLen) {
    if (!str) return '—';
    return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
  }

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Date selector (Tab 1)
    document.querySelectorAll('#metaDateSelector .date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#metaDateSelector .date-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRange = btn.dataset.range;
        loadMetaAds();
      });
    });

    // Refresh
    document.getElementById('metaRefreshBtn').addEventListener('click', loadMetaAds);

    // Export CSV
    document.getElementById('metaExportBtn').addEventListener('click', () => {
      if (allAdsData.length) exportCSV(allAdsData);
      else showToast('No data to export. Load data first.');
    });

    // War Room run button
    document.getElementById('warRoomRunBtn').addEventListener('click', runWarRoom);

    // Table sort
    initTableSort();

    // Auto-load if keys are configured
    const cfg = AppConfig.load();
    if (cfg.WINDSOR_API_KEY && cfg.META_ACCOUNT_ID) {
      loadMetaAds();
    }
  }

  return { init, reload: loadMetaAds };

})();
