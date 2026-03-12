/* ============================================================
   daily-plan.js — Tab 7: Website Action Plan
   Data source: Windsor.ai → searchconsole connector
   AI: Two parallel Claude calls to stay under 4096 output token cap:
       Call A → summary + blog_posts
       Call B → quick_wins + page_fixes + content_updates
   ============================================================ */

'use strict';

const DailyPlan = (() => {
  const GSC_ACCOUNT = 'https://thehousepainters.co.nz/';
  const GSC_ENDPOINT = 'https://connectors.windsor.ai/searchconsole';

  let currentRange = 28; // Default 28 days for richer keyword signal

  const STORAGE_KEY = 'rc_action_plan';

  // ── Date builders ──────────────────────────────────────────
  function buildDates(days) {
    const to = new Date();
    to.setDate(to.getDate() - 1);
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
    const res = await fetch(`${GSC_ENDPOINT}?${p}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Windsor GSC ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    return json.data || json.result || [];
  }

  // ── Claude API ────────────────────────────────────────────
  async function callClaude(systemPrompt, userContent) {
    const key = AppConfig.get('CLAUDE_API_KEY');
    if (!key) throw new Error('Claude API key required — add in Settings.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 4096,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Claude API ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = await res.json();
    return json.content?.[0]?.text || '';
  }

  // ── JSON extraction (handles accidental markdown fences) ──
  function extractJSON(text) {
    const stripped = text
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    return JSON.parse(stripped);
  }

  // ── Aggregate GSC keyword rows ────────────────────────────
  function aggregateKeywords(rows) {
    const map = {};
    rows.forEach(r => {
      if (!r.query) return;
      if (!map[r.query]) map[r.query] = { query: r.query, clicks: 0, impressions: 0, posSum: 0, count: 0 };
      const m = map[r.query];
      m.clicks      += r.clicks      || 0;
      m.impressions += r.impressions || 0;
      m.posSum      += r.position    || 0;
      m.count++;
    });
    return Object.values(map).map(m => ({
      query:       m.query,
      clicks:      m.clicks,
      impressions: m.impressions,
      position:    m.count > 0 ? m.posSum / m.count : 99,
      ctr:         m.impressions > 0 ? m.clicks / m.impressions : 0,
    }));
  }

  // ── Aggregate GSC page rows ───────────────────────────────
  function aggregatePages(rows) {
    const map = {};
    rows.forEach(r => {
      if (!r.page) return;
      if (!map[r.page]) map[r.page] = { page: r.page, clicks: 0, impressions: 0, posWtSum: 0, posImprSum: 0 };
      const m = map[r.page];
      m.clicks      += r.clicks      || 0;
      m.impressions += r.impressions || 0;
      m.posWtSum    += (r.position || 99) * (r.impressions || 0);
      m.posImprSum  += r.impressions || 0;
    });
    return Object.values(map).map(m => ({
      page:        m.page,
      clicks:      m.clicks,
      impressions: m.impressions,
      position:    m.posImprSum > 0 ? m.posWtSum / m.posImprSum : 99,
      ctr:         m.impressions > 0 ? m.clicks / m.impressions : 0,
    }));
  }

  // ── Build data payloads ───────────────────────────────────
  // Returns two separate objects — one per Claude call — to keep
  // each response under the 4096 output token model cap.
  function buildPayloads(keywords, pages) {
    const path = url => url.replace('https://thehousepainters.co.nz', '') || '/';

    // Opportunity zone (6–20): primary blog / quick-win fuel
    const opportunity = keywords
      .filter(k => k.position > 5 && k.position <= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 40)
      .map(k => ({
        query:       k.query,
        position:    +k.position.toFixed(1),
        impressions: k.impressions,
        clicks:      k.clicks,
      }));

    // Dead zone (21–50) with impressions: need new content
    const deadZone = keywords
      .filter(k => k.position > 20 && k.position <= 50 && k.impressions >= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 25)
      .map(k => ({ query: k.query, position: +k.position.toFixed(1), impressions: k.impressions }));

    // Beyond 50 with notable impressions: untapped topics
    const beyond = keywords
      .filter(k => k.position > 50 && k.impressions >= 50)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15)
      .map(k => ({ query: k.query, impressions: k.impressions }));

    // Top pages by clicks — context on what works
    const topPages = [...pages]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 12)
      .map(p => ({
        page:        path(p.page),
        clicks:      p.clicks,
        impressions: p.impressions,
        ctr:         (p.ctr * 100).toFixed(1) + '%',
        position:    +p.position.toFixed(1),
      }));

    // Low-CTR pages: page fix candidates
    const lowCTR = pages
      .filter(p => p.impressions >= 30 && p.position <= 20 && (p.ctr * 100) < 3)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 12)
      .map(p => ({
        page:        path(p.page),
        position:    +p.position.toFixed(1),
        impressions: p.impressions,
        ctr:         (p.ctr * 100).toFixed(1) + '%',
      }));

    const meta = {
      date_range:             `Last ${currentRange} days`,
      total_keywords_tracked: keywords.length,
      total_pages_tracked:    pages.length,
    };

    // Call A gets the keyword opportunity data → drives blog ideas
    const payloadA = { ...meta, opportunity_keywords: opportunity, dead_zone_keywords: deadZone, beyond_50_keywords: beyond };
    // Call B gets page performance data → drives quick wins, fixes, updates
    const payloadB = { ...meta, opportunity_keywords: opportunity.slice(0, 20), top_pages: topPages, low_ctr_pages: lowCTR };

    return { payloadA, payloadB };
  }

  // ── Shared business context (prepended to both prompts) ───
  // Inject today's date so Claude uses the correct year in titles and content
  function getBizContext() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.toLocaleString('en-NZ', { month: 'long' });
    return `You are an expert SEO strategist for The House Painters, an Auckland residential painting company.
TODAY'S DATE: ${month} ${year}. Use ${year} (not any earlier year) in all titles, guides, and cost references.

SERVICES: PRIMARY (unlimited): exterior painting, weatherboard painting/restoration, paint stripping. SECONDARY (max 20%): interior painting. NO standalone content: roof painting (carousel only).
AUDIENCE: Auckland homeowners, property managers, real estate agents.
LOCATION: Auckland NZ — use specific suburbs (North Shore, Remuera, Ponsonby, East Auckland, Titirangi, Devonport, Howick).

Return ONLY valid JSON — no markdown fences, no text outside JSON.`;
  }

  // ── Call A: Summary + Blog Posts ──────────────────────────
  // Note: PROMPT_A and PROMPT_B are functions so they capture the live year
  function PROMPT_A() { return `${getBizContext()}

You will receive GSC keyword data showing opportunity keywords (positions 6–20), dead zone keywords (21–50), and keywords beyond position 50.

Generate a summary and blog post ideas. Return this exact JSON structure:
{
  "summary": "2–3 sentences citing specific numbers from the data — biggest traffic opportunities and how many impressions are being left on the table",
  "blog_posts": [
    {
      "title": "Compelling, keyword-rich blog title",
      "slug": "url-slug",
      "target_keyword": "primary keyword",
      "supporting_keywords": ["kw1", "kw2"],
      "why": "Cite real numbers: e.g. 'Ranking #14 with 820 impressions — just off page 1'",
      "outline": ["Section 1 title", "Section 2 title", "Section 3 title", "Section 4 title"],
      "service": "exterior|weatherboard|paint-stripping|interior|general",
      "priority": "high|medium",
      "estimated_word_count": 1100
    }
  ]
}

Generate exactly 6 blog posts. Prioritise exterior/weatherboard/paint-stripping. At least one must be Auckland suburb-specific. All recommendations must cite real numbers from the data.`; }

  // ── Call B: Quick Wins + Page Fixes + Content Updates ─────
  function PROMPT_B() { return `${getBizContext()}

You will receive GSC data: opportunity keywords (positions 6–20), top pages by clicks, and pages with low CTR despite good positions.

Generate quick wins, page fixes, and content updates. Return this exact JSON structure:
{
  "quick_wins": [
    {
      "keyword": "search query",
      "current_position": 12.3,
      "impressions": 450,
      "clicks": 8,
      "page": "/ranking-page-path",
      "action": "Specific action — e.g. 'Add FAQ answering X. Update H1 to include Y. Add before/after gallery for Z suburb.'"
    }
  ],
  "page_fixes": [
    {
      "url": "/page-path",
      "issue": "Specific issue with numbers — e.g. 'CTR 1.2% at position 7 — title missing location and benefit'",
      "fix": "Specific rewrite — e.g. 'New title: Auckland Exterior Painting — 5-Star Rated. Free Quotes.'",
      "priority": "high|medium|low"
    }
  ],
  "content_updates": [
    {
      "url": "/page-path",
      "what": "Specific update — e.g. 'Add 2025 NZD cost guide section. Add FAQ schema. Add suburb-specific before/after photos.'",
      "why": "Data reason — e.g. 'Position 4 with 1,200 impressions but 2.1% CTR — content thin vs competitors'"
    }
  ]
}

Generate 6 quick wins, 4 page fixes, 3 content updates. Every item must cite real data numbers.`; }

  // ── Escape helper ─────────────────────────────────────────
  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Badge helpers ─────────────────────────────────────────
  function serviceBadge(service) {
    const map = {
      'exterior':        { label: 'Exterior',       cls: 'badge--green' },
      'weatherboard':    { label: 'Weatherboard',   cls: 'badge--green' },
      'paint-stripping': { label: 'Paint Stripping', cls: 'badge--green' },
      'interior':        { label: 'Interior',       cls: 'badge--amber' },
      'general':         { label: 'General',        cls: 'badge--grey'  },
    };
    const cfg = map[service] || map['general'];
    return `<span class="badge ${cfg.cls}">${cfg.label}</span>`;
  }

  function priorityBadge(priority) {
    if (priority === 'high')   return '<span class="badge badge--red">HIGH</span>';
    if (priority === 'medium') return '<span class="badge badge--amber">MEDIUM</span>';
    return '<span class="badge badge--grey">LOW</span>';
  }

  // ── Render: Blog post cards ───────────────────────────────
  function renderBlogPosts(posts) {
    const grid  = document.getElementById('apBlogGrid');
    const count = document.getElementById('apBlogCount');
    if (!grid) return;
    if (count) count.textContent = `${posts.length} ideas`;

    if (!posts.length) {
      grid.innerHTML = '<p class="text-muted" style="padding:1rem">No blog post ideas returned.</p>';
      return;
    }

    grid.innerHTML = posts.map(post => `
      <div class="ap-blog-card">
        <div class="ap-blog-card-header">
          <div class="ap-blog-badges">
            ${priorityBadge(post.priority)}
            ${serviceBadge(post.service)}
          </div>
          <div class="ap-blog-wordcount">~${(post.estimated_word_count || 1000).toLocaleString()} words</div>
        </div>

        <h3 class="ap-blog-title">${esc(post.title)}</h3>

        <div class="ap-blog-target">
          <span class="ap-blog-target-label">🎯 Target keyword</span>
          <strong>${esc(post.target_keyword)}</strong>
        </div>

        ${post.supporting_keywords?.length ? `
        <div class="ap-blog-chips">
          ${post.supporting_keywords.map(k => `<span class="ap-kw-chip">${esc(k)}</span>`).join('')}
        </div>` : ''}

        <div class="ap-blog-why">📊 ${esc(post.why)}</div>

        ${post.outline?.length ? `
        <div class="ap-blog-outline">
          <div class="ap-outline-label">Outline</div>
          <ol class="ap-outline-list">
            ${post.outline.map(h => `<li>${esc(String(h).replace(/^H\d:\s*/, ''))}</li>`).join('')}
          </ol>
        </div>` : ''}

        <div class="ap-blog-slug">
          <span class="ap-blog-slug-label">Suggested URL:</span>
          /blog/${esc(post.slug || '')}
        </div>
      </div>
    `).join('');
  }

  // ── Render: Quick wins table ──────────────────────────────
  function renderQuickWins(wins) {
    const tbody = document.getElementById('apQuickWinsBody');
    if (!tbody) return;
    if (!wins.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-empty">No quick win data returned.</td></tr>';
      return;
    }
    tbody.innerHTML = wins.map(w => `
      <tr>
        <td><strong>${esc(w.keyword)}</strong></td>
        <td class="td-number"><strong>${Number(w.current_position || 0).toFixed(1)}</strong></td>
        <td class="td-number">${formatNumber(w.impressions)}</td>
        <td class="td-number">${formatNumber(w.clicks)}</td>
        <td class="ap-action-cell">${esc(w.action)}</td>
      </tr>
    `).join('');
  }

  // ── Render: Page fixes ────────────────────────────────────
  function renderPageFixes(fixes) {
    const container = document.getElementById('apPageFixesList');
    if (!container) return;
    if (!fixes.length) {
      container.innerHTML = '<p class="text-muted" style="padding:1rem">No page fixes returned.</p>';
      return;
    }
    container.innerHTML = fixes.map(f => `
      <div class="card ap-fix-card ap-fix-card--${f.priority || 'low'}">
        <div class="ap-fix-header">
          ${priorityBadge(f.priority)}
          <span class="ap-fix-url">${esc(f.url)}</span>
        </div>
        <div class="ap-fix-issue">⚠ ${esc(f.issue)}</div>
        <div class="ap-fix-action">✓ ${esc(f.fix)}</div>
      </div>
    `).join('');
  }

  // ── Render: Content updates ───────────────────────────────
  function renderContentUpdates(updates) {
    const container = document.getElementById('apContentUpdatesList');
    if (!container) return;
    if (!updates.length) {
      container.innerHTML = '<p class="text-muted" style="padding:1rem">No content updates returned.</p>';
      return;
    }
    container.innerHTML = updates.map((u, i) => `
      <div class="ap-update-row${i > 0 ? ' ap-update-row--border' : ''}">
        <div class="ap-update-url">${esc(u.url)}</div>
        <div class="ap-update-what">${esc(u.what)}</div>
        <div class="ap-update-why">📊 ${esc(u.why)}</div>
      </div>
    `).join('');
  }

  // ── Render: Summary ───────────────────────────────────────
  function renderSummary(text) {
    const card = document.getElementById('apSummaryCard');
    const el   = document.getElementById('apSummaryText');
    if (card && el && text) {
      el.textContent = text;
      card.style.display = 'block';
    }
  }

  // ── State management ──────────────────────────────────────
  function setState(state) {
    const idle    = document.getElementById('apIdle');
    const loading = document.getElementById('apLoading');
    const results = document.getElementById('apResults');
    const error   = document.getElementById('apError');
    if (idle)    idle.style.display    = state === 'idle'    ? 'block' : 'none';
    if (loading) loading.style.display = state === 'loading' ? 'flex'  : 'none';
    if (results) results.style.display = state === 'results' ? 'block' : 'none';
    if (error)   error.style.display   = state === 'error'   ? 'block' : 'none';
  }

  function showError(msg) {
    const el = document.getElementById('apErrorMsg');
    if (el) el.textContent = msg;
    setState('error');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── localStorage persistence ──────────────────────────────
  function savePlan(planA, planB) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        planA,
        planB,
        timestamp: timestampNow(),
        dateRange: currentRange,
      }));
    } catch (e) {
      console.warn('[ActionPlan] Could not save to localStorage:', e.message);
    }
  }

  function clearSavedPlan() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  // Shows/hides the "cached results" notice inside #apResults
  function showRegenerateNote(isCached) {
    let note = document.getElementById('apCachedNote');
    if (!note) {
      note = document.createElement('p');
      note.id = 'apCachedNote';
      note.style.cssText = 'font-size:0.82rem;color:var(--text-secondary);margin:0 0 1.25rem;';
      const results = document.getElementById('apResults');
      if (results) results.prepend(note);
    }
    note.innerHTML = isCached
      ? `Showing saved results from last session. <button class="btn-link" id="apRegenBtn">↻ Regenerate now</button>`
      : '';
    if (isCached) {
      document.getElementById('apRegenBtn')?.addEventListener('click', () => {
        clearSavedPlan();
        generatePlan();
      });
    }
  }

  function restorePlan(saved) {
    renderSummary(saved.planA.summary || '');
    renderBlogPosts(saved.planA.blog_posts || []);
    renderQuickWins(saved.planB.quick_wins || []);
    renderPageFixes(saved.planB.page_fixes || []);
    renderContentUpdates(saved.planB.content_updates || []);
    setState('results');
    setText('apLastUpdated', `Last generated: ${saved.timestamp} · ${saved.dateRange}-day window`);
    showRegenerateNote(true);
  }

  // ── Main: Generate plan ───────────────────────────────────
  async function generatePlan() {
    if (!AppConfig.get('WINDSOR_API_KEY')) {
      showError('Windsor.ai API key required. Add it in Settings.');
      return;
    }
    if (!AppConfig.get('CLAUDE_API_KEY')) {
      showError('Claude API key required. Add it in Settings.');
      return;
    }

    setState('loading');

    // ── Step 1: Fetch GSC data ─────────────────────────────
    let keywords = [], pages = [];
    try {
      const dates = buildDates(currentRange);
      const [kwRows, pgRows] = await Promise.all([
        fetchGSC(['query', 'clicks', 'impressions', 'position'], dates),
        fetchGSC(['page', 'clicks', 'impressions', 'ctr', 'position'], dates),
      ]);
      keywords = aggregateKeywords(kwRows);
      pages    = aggregatePages(pgRows);
    } catch (err) {
      showError(`Failed to load Windsor.ai data: ${err.message}`);
      return;
    }

    if (!keywords.length && !pages.length) {
      showError('No data returned from Windsor.ai. Check your API key and try a longer date range.');
      return;
    }

    // ── Step 2: Two parallel Claude calls ─────────────────
    // Split the work so each response stays under the 4096 token cap.
    const { payloadA, payloadB } = buildPayloads(keywords, pages);

    let planA, planB;
    try {
      const [rawA, rawB] = await Promise.all([
        callClaude(PROMPT_A(), JSON.stringify(payloadA, null, 2)),
        callClaude(PROMPT_B(), JSON.stringify(payloadB, null, 2)),
      ]);

      try { planA = extractJSON(rawA); }
      catch (e) {
        console.error('[ActionPlan] Call A JSON parse failed:', rawA.slice(0, 500));
        throw new Error(`Blog posts response could not be parsed: ${e.message}`);
      }

      try { planB = extractJSON(rawB); }
      catch (e) {
        console.error('[ActionPlan] Call B JSON parse failed:', rawB.slice(0, 500));
        throw new Error(`Quick wins/fixes response could not be parsed: ${e.message}`);
      }

    } catch (err) {
      showError(err.message);
      return;
    }

    // ── Step 3: Render all sections ────────────────────────
    renderSummary(planA.summary || '');
    renderBlogPosts(planA.blog_posts || []);
    renderQuickWins(planB.quick_wins || []);
    renderPageFixes(planB.page_fixes || []);
    renderContentUpdates(planB.content_updates || []);

    // Persist so results survive hard refresh
    savePlan(planA, planB);

    setState('results');
    setText('apLastUpdated', `Last generated: ${timestampNow()} · ${currentRange}-day window`);
    showRegenerateNote(false);
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    document.getElementById('apRunBtn')?.addEventListener('click', generatePlan);

    document.getElementById('apDateSelector')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-range]');
      if (!btn) return;
      document.querySelectorAll('#apDateSelector .date-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRange = parseInt(btn.dataset.range) || 28;
    });

    // Restore saved plan so results survive hard refresh
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.planA && saved?.planB) {
          restorePlan(saved);
          return; // skip idle state
        }
      }
    } catch (e) {
      console.warn('[ActionPlan] Could not restore saved plan:', e.message);
    }
  }

  return { init, generatePlan };
})();
