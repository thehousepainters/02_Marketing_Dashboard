/* ============================================================
   animations.js — Motion (motion.dev) powered animations
   Covers: AnimatePresence tabs · staggered cards · whileInView
           charts/sections · whileHover on interactive elements
           MutationObserver for dynamically-rendered content
   ============================================================ */

'use strict';

(function () {
  /* ── Grab Motion from CDN global ──────────────────────────── */
  const M = window.Motion;
  if (!M || !M.animate) return;

  const { animate, stagger, inView } = M;
  const hoverFn = M.hover;
  const EASE = 'ease-out';

  /* ── Helpers ──────────────────────────────────────────────── */
  function fadeUp(els, opts) {
    if (!els || (els.length !== undefined && !els.length)) return;
    return animate(els, { opacity: [0, 1], y: [16, 0] },
      Object.assign({ duration: 0.4, easing: EASE }, opts));
  }

  function fadeIn(els, opts) {
    if (!els || (els.length !== undefined && !els.length)) return;
    return animate(els, { opacity: [0, 1] },
      Object.assign({ duration: 0.3, easing: EASE }, opts));
  }

  /* ── 1. AnimatePresence — Tab transitions ─────────────────── */
  /* Animates the incoming panel + staggers all its sections.    */
  function animatePanel(panel) {
    if (!panel) return;

    // Panel fade + slide up
    animate(panel, { opacity: [0, 1], y: [10, 0] }, { duration: 0.28, easing: EASE });

    // Tab header slides down
    const header = panel.querySelector('.tab-header');
    if (header) animate(header, { opacity: [0, 1], y: [-6, 0] }, { duration: 0.25, easing: EASE });

    // Last-updated fades in
    const sub = panel.querySelector('.last-updated');
    if (sub) fadeIn(sub, { delay: 0.06 });

    // Alert panels slide in if visible
    panel.querySelectorAll('.alert-panel, .ana-alert-panel').forEach(el => {
      if (el.style.display !== 'none') {
        animate(el, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.3, easing: EASE });
      }
    });

    // Metric cards — staggered fade-up
    const metrics = panel.querySelectorAll('.metric-card');
    if (metrics.length) {
      fadeUp(metrics, { duration: 0.35, delay: stagger(0.055) });
    }

    // Standard cards — staggered fade-up
    const cards = panel.querySelectorAll('.card');
    if (cards.length) {
      fadeUp(cards, { duration: 0.38, delay: stagger(0.065, { start: 0.04 }) });
    }
  }

  /* Hook into nav clicks (fires after initTabs toggles display) */
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.dataset.tab);
      if (!panel) return;
      requestAnimationFrame(() => animatePanel(panel));
    });
  });

  /* Animate the panel that's active on first load */
  const initial = document.querySelector('.tab-panel.active');
  if (initial) animatePanel(initial);


  /* ── 2. whileInView — Charts & sections ──────────────────── */
  /* Fires when element scrolls into viewport (like whileInView) */
  document.querySelectorAll('.chart-container').forEach(el => {
    inView(el, () => {
      animate(el, { opacity: [0, 1], scale: [0.97, 1] },
        { duration: 0.45, easing: EASE });
    }, { amount: 0.25 });
  });

  /* Zone summary strip (SEO tab) */
  document.querySelectorAll('.zone-summary-strip').forEach(el => {
    inView(el, () => {
      const items = el.querySelectorAll('.zone-strip-item');
      if (items.length) fadeUp(items, { delay: stagger(0.07) });
    }, { amount: 0.2 });
  });

  /* Domination score pillars / score ring */
  document.querySelectorAll('.ds-pillar, .ds-score-ring, .ds-metric-card').forEach(el => {
    inView(el, () => {
      fadeUp(el, { duration: 0.4 });
    }, { amount: 0.15 });
  });


  /* ── 3. MutationObserver — dynamically rendered content ───── */
  /* Catches metric-cards, list rows, and table rows added by    */
  /* module JS (meta-ads.js, analytics.js, etc.) after load.    */
  const observed = new WeakSet();

  const mo = new MutationObserver(mutations => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;

        /* Batch of metric cards added to a grid */
        if (node.classList.contains('metric-card') && !observed.has(node)) {
          observed.add(node);
          const siblings = [...node.parentElement.querySelectorAll('.metric-card')];
          const idx = siblings.indexOf(node);
          fadeUp(node, { delay: idx * 0.055 });
        }

        /* Container holding multiple metric cards (e.g. innerHTML swap) */
        const metrics = node.querySelectorAll?.('.metric-card') || [];
        if (metrics.length) {
          const fresh = [...metrics].filter(m => !observed.has(m));
          fresh.forEach(m => observed.add(m));
          if (fresh.length) fadeUp(fresh, { delay: stagger(0.055) });
        }

        /* List rows: channel-row, device-row */
        const rows = node.querySelectorAll?.('.channel-row, .device-row') || [];
        if (rows.length) {
          const fresh = [...rows].filter(r => !observed.has(r));
          fresh.forEach(r => observed.add(r));
          if (fresh.length) fadeUp(fresh, { duration: 0.3, delay: stagger(0.05) });
        }
        if ((node.classList.contains('channel-row') ||
             node.classList.contains('device-row')) && !observed.has(node)) {
          observed.add(node);
          fadeUp(node, { duration: 0.3 });
        }

        /* Data table rows */
        const trs = node.querySelectorAll?.('tbody tr') || [];
        if (trs.length) {
          const fresh = [...trs].filter(r => !observed.has(r));
          fresh.forEach(r => observed.add(r));
          if (fresh.length) fadeUp(fresh, { duration: 0.28, delay: stagger(0.035) });
        }

        /* Alert panels that become visible */
        if ((node.classList.contains('alert-panel') ||
             node.classList.contains('ana-alert-panel')) &&
            node.style.display !== 'none' && !observed.has(node)) {
          observed.add(node);
          animate(node, { opacity: [0, 1], y: [-8, 0] }, { duration: 0.3, easing: EASE });
        }
      }
    }
  });

  mo.observe(document.body, { childList: true, subtree: true });


  /* ── 4. whileHover — scale effects on interactive elements ── */
  if (typeof hoverFn === 'function') {

    /* Metric cards — scale up */
    hoverFn('.metric-card', el => {
      animate(el, { scale: 1.025, y: -3 }, { duration: 0.2, easing: EASE });
      return () => animate(el, { scale: 1, y: 0 }, { duration: 0.15, easing: EASE });
    });

    /* Standard cards — very subtle lift */
    hoverFn('.card:not(.metric-card)', el => {
      animate(el, { y: -2 }, { duration: 0.2, easing: EASE });
      return () => animate(el, { y: 0 }, { duration: 0.15 });
    });

    /* Nav items — nudge right */
    hoverFn('.nav-item', el => {
      if (el.classList.contains('active')) return;
      animate(el, { x: 3 }, { duration: 0.15 });
      return () => animate(el, { x: 0 }, { duration: 0.12 });
    });

    /* Primary / secondary buttons — lift */
    hoverFn('.btn-primary, .btn-secondary', el => {
      animate(el, { y: -2 }, { duration: 0.15, easing: EASE });
      return () => animate(el, { y: 0 }, { duration: 0.1 });
    });

    /* Date range buttons — scale */
    hoverFn('.date-btn', el => {
      if (el.classList.contains('active')) return;
      animate(el, { scale: 1.06 }, { duration: 0.15, easing: EASE });
      return () => animate(el, { scale: 1 }, { duration: 0.1 });
    });

    /* Refresh / export buttons */
    hoverFn('[id$="RefreshBtn"], [id$="ExportBtn"]', el => {
      animate(el, { scale: 1.05 }, { duration: 0.15 });
      return () => animate(el, { scale: 1 }, { duration: 0.1 });
    });

    /* Nav items active state — subtle pulse on click */
    document.querySelectorAll('.nav-item[data-tab]').forEach(el => {
      el.addEventListener('click', () => {
        animate(el, { scale: [0.96, 1] }, { duration: 0.2, easing: EASE });
      });
    });
  }
})();
