// ============================================================
// Reality Check — Configuration Template
// Copy this file to config.js and fill in your real values.
// config.js is gitignored and will never be committed.
// ============================================================

const CONFIG = {
  // Windsor.ai — Meta Ads data
  // Get your API key at: https://windsor.ai/user/api
  WINDSOR_API_KEY: 'YOUR_WINDSOR_API_KEY',
  META_ACCOUNT_ID: 'YOUR_META_AD_ACCOUNT_ID', // e.g. 'act_123456789'

  // Claude API — AI analysis (Tabs 6, 5, 7)
  // Get your API key at: https://console.anthropic.com/
  CLAUDE_API_KEY: 'YOUR_CLAUDE_API_KEY',

  // Google Search Console — SEO data (Tab 2, 4, 7)
  // OAuth2 credentials from Google Cloud Console
  GSC_CLIENT_ID: 'YOUR_GSC_CLIENT_ID',
  GSC_API_KEY: 'YOUR_GSC_API_KEY',
  GSC_SITE_URL: 'sc-domain:thehousepainters.co.nz',

  // Google Analytics 4 — website analytics (Tab 3, 4, 7)
  GA4_MEASUREMENT_ID: 'YOUR_GA4_MEASUREMENT_ID',
  GA4_PROPERTY_ID: 'YOUR_GA4_PROPERTY_ID',
  GA4_CLIENT_ID: 'YOUR_GA4_CLIENT_ID',

  // Firecrawl — competitor scraping (Tab 5)
  // Get your API key at: https://firecrawl.dev/
  FIRECRAWL_API_KEY: 'YOUR_FIRECRAWL_API_KEY',

  // Alert thresholds (configurable via Settings tab)
  CPL_ALERT_THRESHOLD: 80,       // Alert when CPL exceeds this (NZD)
  FREQUENCY_ALERT_THRESHOLD: 3.5, // Alert when ad frequency exceeds this
  SPEND_ZERO_LEAD_THRESHOLD: 20, // Alert when daily spend > this with 0 leads

  // Site
  SITE_URL: 'https://thehousepainters.co.nz',
};
