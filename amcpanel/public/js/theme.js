/* ============================================================
   AMC PANEL — Aura Theme Engine
   Dark / Light mode + Background theme presets
   Persisted in localStorage
   ============================================================ */
(function () {
  'use strict';

  var THEME_KEY = 'amc_theme';
  var BG_KEY = 'amc_bg';

  var BG_PRESETS = [
    { id: 'none', name: 'Default', css: '' },
    { id: 'aurora', name: 'Aurora', css: 'radial-gradient(60% 55% at 18% 12%, rgba(99,102,241,.55), transparent 65%),radial-gradient(55% 50% at 85% 20%, rgba(168,85,247,.5), transparent 65%),radial-gradient(70% 60% at 60% 95%, rgba(56,189,248,.4), transparent 70%),linear-gradient(160deg,#07080f,#0a0c1c)' },
    { id: 'sunset', name: 'Sunset', css: 'radial-gradient(60% 55% at 18% 12%, rgba(236,72,153,.45), transparent 65%),radial-gradient(55% 50% at 85% 20%, rgba(251,146,60,.4), transparent 65%),radial-gradient(70% 60% at 60% 95%, rgba(99,102,241,.5), transparent 70%),linear-gradient(160deg,#0b0713,#120a1e)' },
    { id: 'ocean', name: 'Ocean', css: 'radial-gradient(60% 55% at 18% 12%, rgba(14,165,233,.5), transparent 65%),radial-gradient(55% 50% at 85% 20%, rgba(20,184,166,.42), transparent 65%),radial-gradient(70% 60% at 60% 95%, rgba(59,130,246,.5), transparent 70%),linear-gradient(160deg,#050d18,#071425)' },
    { id: 'forest', name: 'Forest', css: 'radial-gradient(60% 55% at 18% 12%, rgba(16,185,129,.45), transparent 65%),radial-gradient(55% 50% at 85% 20%, rgba(34,197,94,.35), transparent 65%),radial-gradient(70% 60% at 60% 95%, rgba(99,102,241,.4), transparent 70%),linear-gradient(160deg,#061008,#0a1610)' },
    { id: 'cyber', name: 'Cyber', css: 'radial-gradient(60% 55% at 18% 12%, rgba(34,211,238,.45), transparent 65%),radial-gradient(55% 50% at 85% 20%, rgba(244,63,94,.42), transparent 65%),radial-gradient(70% 60% at 60% 95%, rgba(139,92,246,.55), transparent 70%),linear-gradient(160deg,#07030f,#0c0618)' },
    { id: 'royal', name: 'Royal', css: 'radial-gradient(60% 55% at 18% 12%, rgba(99,102,241,.6), transparent 65%),radial-gradient(55% 50% at 85% 20%, rgba(30,58,138,.6), transparent 65%),radial-gradient(70% 60% at 60% 95%, rgba(124,58,237,.5), transparent 70%),linear-gradient(160deg,#060614,#0a0a20)' }
  ];

  function getStored(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function store(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  /* ---- Theme (dark / light) ---- */
  function applyTheme(mode) {
    var root = document.documentElement;
    var resolved = mode === 'light' ? 'light' : 'dark';
    root.setAttribute('data-theme', resolved);
    store(THEME_KEY, mode);
    if (window.__amcOnTheme) window.__amcOnTheme(mode);
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  /* ---- Background theme ---- */
  function applyBg(id) {
    var body = document.body;
    if (!body) return;
    var preset = BG_PRESETS.find(function (p) { return p.id === id; });
    if (!preset) preset = BG_PRESETS[0];
    body.setAttribute('data-bg', preset.id);
    if (preset.id === 'none') {
      var layer = document.getElementById('bgLayer');
      if (layer) { layer.style.opacity = '1'; layer.style.zIndex = '0'; }
    } else {
      var adminLayer = document.getElementById('bgLayer');
      if (adminLayer) { adminLayer.style.opacity = '0'; }
    }
    store(BG_KEY, preset.id);
    document.querySelectorAll('[data-bg-swatch]').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-bg-swatch') === preset.id);
    });
    if (window.__amcOnBg) window.__amcOnBg(preset);
    return preset;
  }

  function currentBg() {
    return document.body ? (document.body.getAttribute('data-bg') || 'none') : 'none';
  }

  /* ---- UI helpers ---- */
  function buildSwatches(container) {
    var html = BG_PRESETS.map(function (p) {
      var style = p.css
        ? 'style="background:' + p.css + '"'
        : 'style="background:linear-gradient(135deg,var(--bg-tertiary),var(--bg-tertiary))"';
      return '<div class="picker-swatch" data-bg-swatch="' + p.id + '" ' + style +
        ' title="' + p.name + '" onclick="AMCTheme.setBg(\'' + p.id + '\')"></div>';
    }).join('');
    container.innerHTML = '<div class="picker-label">Background Theme</div><div class="picker-grid">' + html + '</div>';
  }

  function bindPopover(triggerId, popoverId, swatchId) {
    var trigger = document.getElementById(triggerId);
    var popover = document.getElementById(popoverId);
    if (!trigger || !popover) return;
    var swatch = document.getElementById(swatchId);
    if (swatch) buildSwatches(swatch);
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var show = !popover.classList.contains('show');
      document.querySelectorAll('.picker-popover, .auth-picker').forEach(function (p) { if (p !== popover) p.classList.remove('show'); });
      popover.classList.toggle('show', show);
    });
    document.addEventListener('click', function (e) {
      if (!popover.contains(e.target) && !trigger.contains(e.target)) popover.classList.remove('show');
    });
  }

  /* ---- Init ---- */
  function init() {
    var defaultTheme = window.__amcDefaultTheme || 'dark';
    var theme = getStored(THEME_KEY, defaultTheme);
    applyTheme(theme);

    var bg = getStored(BG_KEY, 'none');
    // Only apply custom bg if it's a valid preset
    if (BG_PRESETS.some(function (p) { return p.id === bg; })) {
      requestAnimationFrame(function () { applyBg(bg); });
    }

    bindPopover('themePickerTrigger', 'themePicker', 'themePickerSwatches');
    bindPopover('authBgTrigger', 'authBgPicker', 'authBgSwatches');

    // Theme toggle buttons (can be multiple)
    document.querySelectorAll('.theme-toggle, .auth-theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', toggleTheme);
    });
  }

  window.AMCTheme = {
    toggle: toggleTheme,
    setTheme: applyTheme,
    getTheme: currentTheme,
    setBg: applyBg,
    getBg: currentBg,
    presets: BG_PRESETS,
    bind: bindPopover,
    buildSwatches: buildSwatches
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
