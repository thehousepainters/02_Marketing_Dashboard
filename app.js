/* ============================================================
   app.js — Tab switching, shared utilities, settings management
   ============================================================ */

'use strict';

// ============================================================
// CONFIG — merges config.js (if present) with localStorage
// ============================================================
const AppConfig = (() => {
  const STORAGE_KEY = 'rc_config';

  function load() {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // config.js sets a global CONFIG — use it as base truth for API keys
    const base = (typeof CONFIG !== 'undefined') ? CONFIG : {};
    const defaults = {
      WINDSOR_API_KEY: '',
      META_ACCOUNT_ID: '',
      CLAUDE_API_KEY: '',
      GSC_CLIENT_ID: '',
      GA4_PROPERTY_ID: '',
      FIRECRAWL_API_KEY: '',
      CPL_ALERT_THRESHOLD: 80,
      FREQUENCY_ALERT_THRESHOLD: 3.5,
      SPEND_ZERO_LEAD_THRESHOLD: 20,
      SITE_URL: 'https://thehousepainters.co.nz',
      TRACKED_PAGES: [
        'https://thehousepainters.co.nz/services/exterior-house-painting.aspx',
        'https://thehousepainters.co.nz/weatherboard-paint-stripping-auckland',
      ],
      COMPETITOR_URLS: [],
    };
    // Start with defaults + config.js values
    const merged = Object.assign({}, defaults, base);
    // Only let localStorage override if the stored value is non-empty
    // (prevents an empty Settings save from wiping config.js API keys)
    Object.keys(saved).forEach(key => {
      const val = saved[key];
      if (Array.isArray(val) ? val.length > 0 : (val !== '' && val != null)) {
        merged[key] = val;
      }
    });
    return merged;
  }

  function save(updates) {
    const current = load();
    const next = Object.assign(current, updates);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function get(key) { return load()[key]; }

  return { load, save, get };
})();

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function formatNZD(val, decimals = 0) {
  if (val == null || isNaN(val)) return '—';
  return '$' + Number(val).toLocaleString('en-NZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatPercent(val, decimals = 2) {
  if (val == null || isNaN(val)) return '—';
  return Number(val).toFixed(decimals) + '%';
}

function formatNumber(val, decimals = 0) {
  if (val == null || isNaN(val)) return '—';
  return Number(val).toLocaleString('en-NZ', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
}

function toISODate(date) {
  return date.toISOString().split('T')[0];
}

function getDateRange(range) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let from, to;
  if (range === 'yesterday') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    from = to = toISODate(yesterday);
  } else {
    to = toISODate(new Date(today.setDate(today.getDate() - 1)));
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - (parseInt(range) - 1));
    from = toISODate(fromDate);
  }
  return { from, to };
}

function timestampNow() {
  return new Date().toLocaleString('en-NZ', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(msg, duration = 3000) {
  const el = document.getElementById('globalToast');
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.style.display = 'none'; }, duration);
}

// ============================================================
// TAB SWITCHING
// ============================================================
function initTabs() {
  const navBtns = document.querySelectorAll('.nav-tab');
  const panels  = document.querySelectorAll('.tab-panel');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      navBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === target));
      panels.forEach(p => p.classList.toggle('active', p.id === target));
      // Close mobile menu
      document.getElementById('navTabs').classList.remove('open');
    });
  });

  // Mobile hamburger
  document.getElementById('navHamburger').addEventListener('click', () => {
    document.getElementById('navTabs').classList.toggle('open');
  });
}

// ============================================================
// SETTINGS TAB
// ============================================================
function initSettings() {
  const cfg = AppConfig.load();

  // Populate fields
  setVal('settingWindsorKey',       cfg.WINDSOR_API_KEY);
  setVal('settingMetaAccountId',    cfg.META_ACCOUNT_ID);
  setVal('settingClaudeKey',        cfg.CLAUDE_API_KEY);
  setVal('settingGSCClientId',      cfg.GSC_CLIENT_ID);
  setVal('settingGA4PropertyId',    cfg.GA4_PROPERTY_ID);
  setVal('settingFirecrawlKey',     cfg.FIRECRAWL_API_KEY);
  setVal('settingCPLThreshold',     cfg.CPL_ALERT_THRESHOLD);
  setVal('settingFreqThreshold',    cfg.FREQUENCY_ALERT_THRESHOLD);
  setVal('settingZeroLeadThreshold',cfg.SPEND_ZERO_LEAD_THRESHOLD);

  renderTrackedPages(cfg.TRACKED_PAGES || []);
  renderCompetitors(cfg.COMPETITOR_URLS || []);

  // Save button — saves then reloads any active data modules
  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    saveSettings();
    if (typeof MetaAds !== 'undefined') MetaAds.reload();
  });

  // Tracked pages
  document.getElementById('addTrackedPageBtn').addEventListener('click', () => {
    document.getElementById('addPageForm').style.display = 'flex';
  });
  document.getElementById('cancelAddPageBtn').addEventListener('click', () => {
    document.getElementById('addPageForm').style.display = 'none';
    document.getElementById('newPageUrl').value = '';
  });
  document.getElementById('confirmAddPageBtn').addEventListener('click', () => {
    const url = document.getElementById('newPageUrl').value.trim();
    if (!url) return;
    const cfg2 = AppConfig.load();
    const pages = cfg2.TRACKED_PAGES || [];
    if (!pages.includes(url)) {
      pages.push(url);
      AppConfig.save({ TRACKED_PAGES: pages });
      renderTrackedPages(pages);
    }
    document.getElementById('addPageForm').style.display = 'none';
    document.getElementById('newPageUrl').value = '';
  });

  // Competitors
  document.getElementById('addCompetitorBtn').addEventListener('click', () => {
    document.getElementById('addCompetitorForm').style.display = 'flex';
  });
  document.getElementById('cancelAddCompetitorBtn').addEventListener('click', () => {
    document.getElementById('addCompetitorForm').style.display = 'none';
    document.getElementById('newCompetitorUrl').value = '';
  });
  document.getElementById('confirmAddCompetitorBtn').addEventListener('click', () => {
    const url = document.getElementById('newCompetitorUrl').value.trim();
    if (!url) return;
    const cfg2 = AppConfig.load();
    const comps = cfg2.COMPETITOR_URLS || [];
    if (!comps.includes(url)) {
      comps.push(url);
      AppConfig.save({ COMPETITOR_URLS: comps });
      renderCompetitors(comps);
    }
    document.getElementById('addCompetitorForm').style.display = 'none';
    document.getElementById('newCompetitorUrl').value = '';
  });
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val != null) el.value = val;
}

function saveSettings() {
  AppConfig.save({
    WINDSOR_API_KEY:            getVal('settingWindsorKey'),
    META_ACCOUNT_ID:            getVal('settingMetaAccountId'),
    CLAUDE_API_KEY:             getVal('settingClaudeKey'),
    GSC_CLIENT_ID:              getVal('settingGSCClientId'),
    GA4_PROPERTY_ID:            getVal('settingGA4PropertyId'),
    FIRECRAWL_API_KEY:          getVal('settingFirecrawlKey'),
    CPL_ALERT_THRESHOLD:        parseFloat(getVal('settingCPLThreshold')) || 80,
    FREQUENCY_ALERT_THRESHOLD:  parseFloat(getVal('settingFreqThreshold')) || 3.5,
    SPEND_ZERO_LEAD_THRESHOLD:  parseFloat(getVal('settingZeroLeadThreshold')) || 20,
  });
  showToast('Settings saved ✓');
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function renderTrackedPages(pages) {
  const container = document.getElementById('trackedPagesList');
  if (!pages.length) {
    container.innerHTML = '<p style="padding:1rem 1.25rem;font-size:0.875rem;color:var(--text-muted)">No pages tracked yet.</p>';
    return;
  }
  container.innerHTML = pages.map((url, i) => `
    <div class="tracked-page-item">
      <span class="tracked-page-url" title="${url}">${url}</span>
      <button class="remove-btn" data-type="page" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('.remove-btn[data-type="page"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cfg = AppConfig.load();
      cfg.TRACKED_PAGES.splice(parseInt(btn.dataset.index), 1);
      AppConfig.save({ TRACKED_PAGES: cfg.TRACKED_PAGES });
      renderTrackedPages(cfg.TRACKED_PAGES);
    });
  });
}

function renderCompetitors(urls) {
  const container = document.getElementById('competitorsList');
  if (!urls.length) {
    container.innerHTML = '<p style="padding:1rem 1.25rem;font-size:0.875rem;color:var(--text-muted)">No competitors added yet.</p>';
    return;
  }
  container.innerHTML = urls.map((url, i) => `
    <div class="competitor-item">
      <span class="competitor-url" title="${url}">${url}</span>
      <button class="remove-btn" data-type="comp" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');
  container.querySelectorAll('.remove-btn[data-type="comp"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cfg = AppConfig.load();
      cfg.COMPETITOR_URLS.splice(parseInt(btn.dataset.index), 1);
      AppConfig.save({ COMPETITOR_URLS: cfg.COMPETITOR_URLS });
      renderCompetitors(cfg.COMPETITOR_URLS);
    });
  });
}

// ============================================================
// CHART.JS DEFAULTS
// ============================================================
function initChartDefaults() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#6b7280';
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = '#111827';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.scale.grid.color = '#f1f5f9';
  Chart.defaults.scale.border.display = false;
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  // One-time cleanup: remove any previously saved empty API keys from localStorage
  // so config.js values always win when localStorage has blank strings.
  const _saved = JSON.parse(localStorage.getItem('rc_config') || '{}');
  const _apiKeys = ['WINDSOR_API_KEY','META_ACCOUNT_ID','CLAUDE_API_KEY','GSC_CLIENT_ID','GA4_PROPERTY_ID','FIRECRAWL_API_KEY'];
  let _changed = false;
  _apiKeys.forEach(k => { if (_saved[k] === '') { delete _saved[k]; _changed = true; } });
  if (_changed) localStorage.setItem('rc_config', JSON.stringify(_saved));

  initTabs();
  initSettings();
  initChartDefaults();

  // Trigger module inits (defined in their own files)
  if (typeof MetaAds !== 'undefined') MetaAds.init();
  if (typeof SEO !== 'undefined') SEO.init();
  if (typeof Analytics !== 'undefined') Analytics.init();
  if (typeof PageTracker !== 'undefined') PageTracker.init();
  if (typeof Competitors !== 'undefined') Competitors.init();
  if (typeof DailyPlan !== 'undefined') DailyPlan.init();
  if (typeof DominationScore !== 'undefined') DominationScore.init();
});
