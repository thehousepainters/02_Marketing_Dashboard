/* ============================================================
   daily-plan.js — Tab 7: Website Action Plan
   Data source: Windsor.ai → searchconsole connector
   AI: Claude API — structured JSON action plan
   ============================================================ */

'use strict';

const DailyPlan = (() => {
  const GSC_ACCOUNT = 'https://thehousepainters.co.nz/';
  const GSC_ENDPOINT = 'https://connectors.windsor.ai/searchconsole';

  let currentRange = 28; // Default 28 days for richer keyword signal

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
        model:     'claude-sonnet-4-5',
        max_tokens: 4096,
        system:    systemPrompt,
        messages:  [{ role: 'user', content: userContent }],
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
    // Strip ```json ... ``` or ``` ... ``` wrappers if Claude adds them
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

  // ── Build compact data payload for Claude ─────────────────
  // Carefully curated: most valuable signal, fewest tokens
  function buildPayload(keywords, pages) {
    const path = url => url.replace('https://thehousepainters.co.nz', '') || '/';

    // Opportunity zone (6–20): most likely to reach page 1 — primary blog fuel
    const opportunity = keywords
      .filter(k => k.position > 5 && k.position <= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 50)
      .map(k => ({
        query:       k.query,
        position:    +k.position.toFixed(1),
        impressions: k.impressions,
        clicks:      k.clicks,
        ctr:         (k.ctr * 100).toFixed(1) + '%',
      }));

    // Dead zone (21–50) with decent impressions: need new/better content
    const deadZone = keywords
      .filter(k => k.position > 20 && k.position <= 50 && k.impressions >= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 30)
      .map(k => ({
        query:       k.query,
        position:    +k.position.toFixed(1),
        impressions: k.impressions,
        clicks:      k.clicks,
      }));

    // Beyond position 50 with notable impressions: brand new topic opportunities
    const beyond = keywords
      .filter(k => k.position > 50 && k.impressions >= 50)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 20)
      .map(k => ({ query: k.query, impressions: k.impressions }));

    // Top pages by clicks — context on what already works
    const topPages = [...pages]
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 15)
      .map(p => ({
        page:        path(p.page),
        clicks:      p.clicks,
        impressions: p.impressions,
        ctr:         (p.ctr * 100).toFixed(1) + '%',
        position:    +p.position.toFixed(1),
      }));

    // Low-CTR pages with decent impressions and position ≤ 20
    const lowCTR = pages
      .filter(p => p.impressions >= 30 && p.position <= 20 && (p.ctr * 100) < 3)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 15)
      .map(p => ({
        page:        path(p.page),
        position:    +p.position.toFixed(1),
        impressions: p.impressions,
        ctr:         (p.ctr * 100).toFixed(1) + '%',
      }));

    return {
      date_range:             `Last ${currentRange} days`,
      total_keywords_tracked: keywords.length,
      total_pages_tracked:    pages.length,
      opportunity_keywords:   opportunity,   // positions 6–20 — BLOG IDEAS FUEL
      dead_zone_keywords:     deadZone,      // positions 21–50
      beyond_50_keywords:     beyond,        // impressions but position 50+
      top_pages_by_clicks:    topPages,      // what already works
      low_ctr_pages:          lowCTR,        // page fix candidates
    };
  }

  // ── System prompt ─────────────────────────────────────────
  const SYSTEM_PROMPT = `You are an expert SEO strategist and content planner for The House Painters, an Auckland residential painting company.

BUSINESS CONTEXT:
- PRIMARY services (unlimited content/spend): Exterior house painting, weatherboard painting/restoration, paint stripping
- SECONDARY (max ~20% of content): Interior house painting
- CAROUSEL ONLY — no standalone content, no new blog posts: Roof painting
- Target audience: Auckland homeowners, property managers, real estate agents preparing to sell
- Location: Auckland, New Zealand — mention specific suburbs (North Shore, Remuera, Ponsonby, East Auckland, South Auckland, Titirangi, Devonport, etc.)
- Competitive market: differentiate on quality, experience, warranty, Auckland-specific knowledge

CONTENT RULES:
- Every blog post must target a keyword with clear search intent
- Auckland-specific angles strongly preferred over generic advice (e.g. "Auckland weather + weatherboard" not just "weatherboard painting")
- Practical, decision-helping content outperforms thin promotional content
- Never create standalone roof painting content — carousel mentions only
- Interior painting content should not dominate — max 1–2 blog ideas out of the total

You will receive Google Search Console data: keyword rankings (with positions, impressions, clicks) and page performance (with CTR and positions).

Analyse ALL sections of the data provided and return a JSON action plan. Return ONLY valid JSON — no markdown code fences, no commentary outside the JSON.

Required JSON structure:
{
  "summary": "2–3 sentence executive summary citing the biggest specific opportunities with real numbers from the data",
  "blog_posts": [
    {
      "title": "Exact, compelling blog post title — keyword-rich but human-readable",
      "slug": "url-slug-for-this-post",
      "target_keyword": "primary keyword to rank for",
      "supporting_keywords": ["related keyword 1", "related keyword 2", "related keyword 3"],
      "why": "Data-driven reason — cite real numbers (e.g. 'Ranking #14 with 820 impressions — one push from page 1')",
      "outline": ["H2: Section title", "H2: Section title", "H2: Section title", "H2: Section title", "H2: Section title"],
      "service": "exterior|weatherboard|paint-stripping|interior|general",
      "priority": "high|medium",
      "estimated_word_count": 1200
    }
  ],
  "quick_wins": [
    {
      "keyword": "search query",
      "current_position": 12.3,
      "impressions": 450,
      "clicks": 8,
      "page": "/current-ranking-page-path",
      "action": "Specific, concrete action — e.g. 'Add a FAQ section covering X. Rewrite H1 to include Y. Add 3 before/after photos showing Z.'"
    }
  ],
  "page_fixes": [
    {
      "url": "/page-path",
      "issue": "Specific issue — e.g. 'CTR of 1.2% at position 7 — title tag missing location and benefit'",
      "fix": "Specific fix with example — e.g. 'Rewrite title to: Auckland Exterior House Painting — 5-Star Rated. Free Quotes.'",
      "priority": "high|medium|low"
    }
  ],
  "content_updates": [
    {
      "url": "/page-path",
      "what": "Specific update — e.g. 'Add a cost guide section (NZD ranges for 2025 Auckland prices). Add FAQ schema markup.'",
      "why": "Data-backed reason — e.g. 'Ranking #4 with 1,200 impressions but only 2.1% CTR — content appears thin vs competitors'"
    }
  ]
}

REQUIREMENTS:
- Generate 6–10 blog post ideas — this is the most important section
- Generate 5–10 quick wins from opportunity zone keywords (positions 6–20)
- Generate 3–6 page fixes for low-CTR or underperforming pages
- Generate 3–5 content updates for existing pages
- Every recommendation must be specific, actionable, and data-referenced
- No generic SEO advice (no "add keywords to your page" without specifics)
- Prioritise exterior house painting, weatherboard, and paint stripping topics
- At least one blog post idea should be Auckland suburb-specific or season-specific`;

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
            ${post.outline.map(h => `<li>${esc(h.replace(/^H\d:\s*/, ''))}</li>`).join('')}
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

    const dates = buildDates(currentRange);
    let keywords = [], pages = [];

    // ── Step 1: Fetch GSC data ─────────────────────────────
    try {
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

    // ── Step 2: Build payload & call Claude ────────────────
    const payload = buildPayload(keywords, pages);
    let rawResponse = '';
    try {
      rawResponse = await callClaude(SYSTEM_PROMPT, JSON.stringify(payload, null, 2));
    } catch (err) {
      showError(`Claude API error: ${err.message}`);
      return;
    }

    // ── Step 3: Parse JSON response ────────────────────────
    let plan;
    try {
      plan = extractJSON(rawResponse);
    } catch (err) {
      console.error('[ActionPlan] JSON parse failed. Raw response:', rawResponse.slice(0, 800));
      showError(`Could not parse Claude's response as JSON. Raw response logged to console. (${err.message})`);
      return;
    }

    // ── Step 4: Render all sections ────────────────────────
    renderSummary(plan.summary || '');
    renderBlogPosts(plan.blog_posts || []);
    renderQuickWins(plan.quick_wins || []);
    renderPageFixes(plan.page_fixes || []);
    renderContentUpdates(plan.content_updates || []);

    setState('results');
    setText('apLastUpdated', `Last generated: ${timestampNow()}`);
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
  }

  return { init, generatePlan };
})();
