/* Aura Animation Engine - scroll reveal, staggered entrances, count-up, ripple */
(function () {
    'use strict';

    function prefersReduced() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    /* ----- Count-up animation ----- */
    function animateCount(el) {
        var target = parseFloat(el.getAttribute('data-count-up'));
        var decimals = (el.getAttribute('data-count-decimals') || '').length;
        if (isNaN(target)) target = parseFloat(el.textContent) || 0;
        var suffix = el.getAttribute('data-suffix') || '';
        var prefix = el.getAttribute('data-prefix') || '';
        var dur = parseInt(el.getAttribute('data-duration') || '1400', 10);
        var start = null;
        if (prefersReduced()) {
            el.textContent = prefix + target.toFixed(decimals) + suffix;
            return;
        }
        function step(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / dur, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = prefix + (target * eased).toFixed(decimals) + suffix;
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    /* ----- Ripple effect ----- */
    function ripple(btn, x, y) {
        var rect = btn.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        var ink = document.createElement('span');
        ink.className = 'ripple-ink';
        ink.style.width = ink.style.height = size + 'px';
        ink.style.left = (x - rect.left - size / 2) + 'px';
        ink.style.top = (y - rect.top - size / 2) + 'px';
        btn.appendChild(ink);
        setTimeout(function () { if (ink.parentElement) ink.parentElement.removeChild(ink); }, 650);
    }

    /* ----- Reveal on scroll ----- */
    var revealObserver = null;
    function observeReveals(root) {
        if (prefersReduced()) {
            root.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('visible'); });
            return;
        }
        if (!('IntersectionObserver' in window)) {
            root.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('visible'); });
            return;
        }
        var items = root.querySelectorAll('.reveal:not(.visible)');
        if (!items.length) return;
        if (!revealObserver) {
            revealObserver = new IntersectionObserver(function (entries) {
                entries.forEach(function (en) {
                    if (en.isIntersecting) {
                        en.target.classList.add('visible');
                        revealObserver.unobserve(en.target);
                    }
                });
            }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
        }
        items.forEach(function (el) { revealObserver.observe(el); });
    }

    /* ----- Staggered grid entrance ----- */
    function stagger(root) {
        if (prefersReduced()) return;
        var grids = root.querySelectorAll('.stats-grid, .server-grid, .grid-2, .grid-3, .grid-4, .cards-grid');
        grids.forEach(function (grid) {
            var kids = Array.prototype.slice.call(grid.children);
            var show = 8;
            kids.slice(0, show).forEach(function (el) { el.classList.add('stagger-anim'); });
        });
    }

    /* ----- Apply everything to a container ----- */
    function scan(root) {
        var ctx = root || document;
        if (ctx.querySelectorAll) {
            observeReveals(ctx);
            stagger(ctx);
            ctx.querySelectorAll('[data-count-up]').forEach(function (el) {
                if (el.dataset.counted) return;
                el.dataset.counted = '1';
                var t = new IntersectionObserver ? null : null;
                if ('IntersectionObserver' in window && !prefersReduced()) {
                    var io = new IntersectionObserver(function (entries, obs) {
                        entries.forEach(function (en) {
                            if (en.isIntersecting) { animateCount(en.target); obs.unobserve(en.target); }
                        });
                    }, { threshold: 0.4 });
                    io.observe(el);
                } else {
                    animateCount(el);
                }
            });
        }
    }

    /* ----- Global refresh hook (called after SPA swaps content) ----- */
    window.AMCAnimate = {
        refresh: function () { scan(document); },
        ripple: ripple
    };

    /* ----- Bind ripple to .ripple elements ----- */
    document.addEventListener('click', function (e) {
        var t = e.target.closest ? e.target.closest('.ripple') : null;
        if (t) ripple(t, e.clientX, e.clientY);
    });

    /* ----- Auto-detect content swaps via MutationObserver ----- */
    var lastText = '';
    if (window.MutationObserver) {
        var mo = new MutationObserver(function (muts) {
            var pageWrap = document.querySelector('.page-wrap');
            if (!pageWrap) return;
            var txt = pageWrap.textContent.length;
            if (Math.abs(txt - lastText) > 400) {
                lastText = txt;
                setTimeout(function () { scan(document); }, 50);
            } else {
                lastText = txt;
            }
        });
        document.addEventListener('DOMContentLoaded', function () {
            var pageWrap = document.querySelector('.page-wrap');
            lastText = pageWrap ? pageWrap.textContent.length : 0;
            mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        scan(document);
    });

    /* Re-scan after socket-driven reloads */
    window.addEventListener('load', function () { setTimeout(function () { scan(document); }, 80); });
})();
