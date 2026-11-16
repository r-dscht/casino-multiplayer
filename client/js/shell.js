/**
 * shell.js — Responsive app shell behaviour.
 * - Social drawer (chat / ranglijst / profiel) toggle for tablet & mobile widths
 * - Exposes viewport size class on <html> (data-vp) so CSS & games can adapt
 * - Keeps Three.js canvases in sync when the shell geometry changes
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  const app = document.getElementById('casino-app');
  const btn = document.getElementById('btn-toggle-social');
  const backdrop = document.getElementById('social-backdrop');
  if (!app) return;

  function setSocial(open) {
    app.classList.toggle('social-open', !!open);
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  if (btn) btn.addEventListener('click', () => setSocial(!app.classList.contains('social-open')));
  if (backdrop) backdrop.addEventListener('click', () => setSocial(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.classList.contains('social-open')) setSocial(false);
  });

  // Close drawer automatically after switching games on small screens
  document.querySelectorAll('.game-pill, .dock-left-btn').forEach(el => {
    el.addEventListener('click', () => setSocial(false));
  });

  function classify() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const vp = w < 760 ? 'phone' : (w < 1280 ? 'tablet' : 'desktop');
    document.documentElement.setAttribute('data-vp', vp);
    document.documentElement.classList.toggle('vp-short', h < 800);
    if (vp === 'desktop' && app.classList.contains('social-open')) setSocial(false);
  }

  let raf = 0;
  function onResize() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      classify();
      // Nudge canvases (Three.js / crash) to re-measure after layout changes
      window.dispatchEvent(new Event('shell:resize'));
    });
  }

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.addEventListener('themeChanged', () => setTimeout(() => window.dispatchEvent(new Event('resize')), 60));
  classify();

  window.CasinoShell = { setSocial };
})();
