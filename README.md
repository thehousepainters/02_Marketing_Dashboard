# Reality Check — Marketing Intelligence Dashboard

Marketing command centre for [The House Painters](https://thehousepainters.co.nz), Auckland NZ.

Live dashboard: **https://thehousepainters.github.io/02_Marketing_Dashboard/**

---

## What it does

9-tab static dashboard combining Meta Ads, SEO, GA4, competitor intelligence, and AI-powered daily action plans — all in one place, hosted on GitHub Pages.

| Tab | Name | Data Source |
|-----|------|-------------|
| 1 | Meta Ads Daily Performance | Windsor.ai |
| 2 | SEO Rankings & Daily Alerts | Google Search Console |
| 3 | Website Analytics & Daily Alerts | Google Analytics 4 |
| 4 | Page Tracker | GSC + GA4 |
| 5 | Competitor Intelligence | Firecrawl + Claude |
| 6 | Daily Meta Ads War Room | Windsor.ai + Claude |
| 7 | Daily Website Action Plan | GSC + GA4 + Claude |
| 8 | Market Domination Score | All sources |
| 9 | Settings & Configuration | Local |

---

## Setup

### 1. Clone and configure

```bash
git clone https://github.com/thehousepainters/02_Marketing_Dashboard.git
cd 02_Marketing_Dashboard
cp config.example.js config.js
```

Edit `config.js` with your API keys (see sections below).

### 2. Open locally

Open `index.html` directly in a browser. No build step needed.

---

## API Setup

### Windsor.ai (Meta Ads — Tabs 1 & 6)

1. Log into [windsor.ai](https://windsor.ai)
2. Go to **Settings → API** and copy your API key
3. Find your Meta Ad Account ID in Meta Ads Manager (format: `act_XXXXXXXXX`)
4. Add both to `config.js`

### Claude API (AI analysis — Tabs 5, 6, 7)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key under **API Keys**
3. Add to `config.js` as `CLAUDE_API_KEY`

> Note: Claude API calls are made directly from the browser. Keep this dashboard private or use a proxy for production use.

### Google Search Console (SEO — Tabs 2, 4, 7)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project, enable the **Search Console API**
3. Create OAuth 2.0 credentials (Web Application type)
4. Add your GitHub Pages URL as an authorised redirect URI
5. Copy Client ID and API key to `config.js`

### Google Analytics 4 (Analytics — Tabs 3, 4, 7)

1. In Google Cloud Console, enable the **Google Analytics Data API**
2. Use the same OAuth credentials as GSC, or create separate ones
3. Find your GA4 Property ID in GA4 → Admin → Property Settings
4. Copy to `config.js`

### Firecrawl (Competitor scraping — Tab 5)

1. Sign up at [firecrawl.dev](https://firecrawl.dev)
2. Copy your API key from the dashboard
3. Add to `config.js` as `FIRECRAWL_API_KEY`
4. Add competitor URLs in the Settings tab (Tab 9)

---

## Service & Budget Rules

These rules are hard-coded into all AI prompts and alert logic:

| Service | Ad Spend | Content |
|---------|----------|---------|
| Exterior painting | Unlimited | Primary focus |
| Weatherboard painting | Unlimited | Primary focus |
| Paint stripping | Unlimited | Primary focus |
| Interior painting | Max 20% of total | Secondary |
| Roof painting | 0% standalone | Carousel only, no new blog posts |

---

## Alert Thresholds (configurable in Settings tab)

- CPL alert: > $80 NZD
- Frequency alert: > 3.5
- Zero-lead alert: spending > $20/day with 0 leads

---

## Tech Stack

- HTML + CSS + vanilla JavaScript
- [Chart.js](https://chartjs.org) for charts
- Fetch API for all external data calls
- GitHub Pages for hosting (no server needed)
