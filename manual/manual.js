/* Parallax Monitor / ZR Ctl user manual — shared behaviour.
   Builds the chapter list, the on-this-page list, prev/next links and search. */
(function () {
  'use strict';

  // One entry per chapter page. Order is the reading order.
  var CHAPTERS = [
    { group: 'Start here' },
    { slug: 'index',            num: '00', title: 'Manual overview' },
    { slug: 'tips',             num: '01', title: 'Tips and tricks' },
    { slug: 'known-issues',     num: '02', title: 'Known issues' },
    { slug: 'basics',           num: '03', title: 'Cinematography basics' },
    { slug: 'cameras',          num: '04', title: 'Supported cameras' },
    { group: 'Setting up' },
    { slug: 'connect',          num: '05', title: 'Connection' },
    { slug: 'live-view',        num: '06', title: 'Live View page' },
    { group: 'Monitoring tools' },
    { slug: 'exposure-tools',   num: '07', title: 'Exposure tools' },
    { slug: 'focus-tools',      num: '08', title: 'Focus tools' },
    { slug: 'luts',             num: '09', title: 'LUTs and looks' },
    { slug: 'framing',          num: '10', title: 'Framing and guides' },
    { group: 'Camera control' },
    { slug: 'controls',         num: '11', title: 'Controls page' },
    { slug: 'stills',           num: '12', title: 'Stills, timelapse, stacking' },
    { slug: 'playback',         num: '13', title: 'Playback' },
    { group: 'Rigs' },
    { slug: 'multicam',         num: '14', title: 'Multicam' },
    { slug: 'remote',           num: '15', title: 'Remote Viewer and HDMI' },
    { slug: 'red',              num: '16', title: 'RED cameras' },
    { group: 'Reference' },
    { slug: 'advanced',         num: '17', title: 'Advanced settings' },
    { slug: 'troubleshooting',  num: '18', title: 'Troubleshooting and FAQ' },
    { slug: 'glossary',         num: '19', title: 'Glossary' }
  ];

  function currentSlug() {
    var path = window.location.pathname.replace(/\/+$/, '');
    var last = path.split('/').pop();
    if (!last || last === 'manual' || last === 'index.html') return 'index';
    return last.replace(/\.html$/, '');
  }

  function hrefFor(slug) {
    return slug === 'index' ? '/manual/' : '/manual/' + slug + '/';
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  var slug = currentSlug();

  // Chapter list
  var list = document.getElementById('chapterList');
  if (list) {
    CHAPTERS.forEach(function (c) {
      if (c.group) { list.appendChild(el('li', { 'class': 'group', text: c.group })); return; }
      var a = el('a', { href: hrefFor(c.slug) }, [
        el('span', { 'class': 'num', text: c.num }),
        el('span', { text: c.title })
      ]);
      if (c.slug === slug) a.setAttribute('aria-current', 'page');
      list.appendChild(el('li', null, [a]));
    });
  }

  // On-this-page list from h2 / h3 (h3 only when the page is not huge)
  var toc = document.getElementById('pageToc');
  var article = document.querySelector('.manual-article');
  var headings = [];
  if (toc && article) {
    var h2s = article.querySelectorAll('h2[id]');
    var includeH3 = article.querySelectorAll('h3[id]').length <= 40;
    article.querySelectorAll(includeH3 ? 'h2[id], h3[id]' : 'h2[id]').forEach(function (h) {
      var li = el('li', h.tagName === 'H3' ? { 'class': 'sub' } : null, [
        el('a', { href: '#' + h.id, text: h.getAttribute('data-short') || h.textContent.replace(/#$/, '').trim() })
      ]);
      toc.appendChild(li);
      headings.push(h);
    });
    if (!h2s.length) toc.parentNode.style.display = 'none';

    // Anchor links on headings
    article.querySelectorAll('h2[id], h3[id]').forEach(function (h) {
      var a = el('a', { 'class': 'anchor', href: '#' + h.id, 'aria-label': 'Link to this section', text: '#' });
      h.appendChild(a);
    });

    // Active section highlight
    var links = toc.querySelectorAll('a');
    var setActive = function () {
      var offset = window.innerHeight * 0.25;
      var current = null;
      headings.forEach(function (h) { if (h.getBoundingClientRect().top <= offset) current = h; });
      links.forEach(function (a) { a.classList.toggle('active', !!current && a.getAttribute('href') === '#' + current.id); });
    };
    window.addEventListener('scroll', setActive, { passive: true });
    setActive();
  }

  // Prev / next
  var nav = document.getElementById('chapterNav');
  if (nav) {
    var pages = CHAPTERS.filter(function (c) { return c.slug; });
    var idx = pages.findIndex(function (c) { return c.slug === slug; });
    if (idx > 0) {
      var p = pages[idx - 1];
      nav.appendChild(el('a', { 'class': 'prev', href: hrefFor(p.slug) }, [el('span', { text: 'Previous' }), el('strong', { text: p.num + ' · ' + p.title })]));
    } else nav.appendChild(el('span'));
    if (idx >= 0 && idx < pages.length - 1) {
      var n = pages[idx + 1];
      nav.appendChild(el('a', { 'class': 'next', href: hrefFor(n.slug) }, [el('span', { text: 'Next' }), el('strong', { text: n.num + ' · ' + n.title })]));
    }
  }

  // Sidebar toggle (small screens)
  var toggle = document.getElementById('sidebarToggle');
  var sidebar = document.getElementById('manualSidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', function () {
      var open = sidebar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Site nav hamburger
  var hamburger = document.getElementById('hamburger');
  var navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', function () {
      var open = navLinks.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // Update banner dismiss (same storage key as the rest of the site)
  document.querySelectorAll('.update-close').forEach(function (button) {
    button.addEventListener('click', function () {
      document.documentElement.classList.add('update-dismissed');
      try { localStorage.setItem(window.ZRCTL_UPDATE_BANNER_STORAGE_KEY, window.ZRCTL_UPDATE_BANNER_VERSION); } catch (_) {}
    });
  });

  // Search across every chapter. The index is generated by scripts/build-manual-index.py.
  var input = document.getElementById('manualSearch');
  var results = document.getElementById('searchResults');
  if (input && results) {
    var index = null, loading = false, pending = null;
    var load = function (cb) {
      if (index) return cb();
      pending = cb;
      if (loading) return;
      loading = true;
      var done = function () { loading = false; var fn = pending; pending = null; if (fn) fn(); };
      fetch('/manual/search-index.json').then(function (r) { return r.json(); }).then(function (data) {
        index = data; done();
      }).catch(function () { index = []; done(); });
    };
    var render = function (q) {
      results.innerHTML = '';
      if (!q) { results.classList.remove('open'); return; }
      var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      var hits = index.map(function (entry) {
        var hay = (entry.title + ' ' + entry.text + ' ' + entry.chapter).toLowerCase();
        var score = 0;
        terms.forEach(function (t) {
          if (entry.title.toLowerCase().indexOf(t) >= 0) score += 3;
          if (hay.indexOf(t) >= 0) score += 1;
        });
        return terms.every(function (t) { return hay.indexOf(t) >= 0; }) ? { entry: entry, score: score } : null;
      }).filter(Boolean).sort(function (a, b) { return b.score - a.score; }).slice(0, 12);
      if (!hits.length) {
        results.appendChild(el('div', { 'class': 'empty', text: 'No matches. Try a tool name (for example "zebras") or a camera setting.' }));
      } else {
        hits.forEach(function (h) {
          var a = el('a', { href: h.entry.url, text: h.entry.title }, [el('small', { text: h.entry.chapter })]);
          results.appendChild(a);
        });
      }
      results.classList.add('open');
    };
    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (!q) { render(''); return; }
      load(function () { render(q); });
    });
    input.addEventListener('focus', function () { load(function () {}); });
    document.addEventListener('click', function (e) {
      if (!results.contains(e.target) && e.target !== input) results.classList.remove('open');
    });
  }
})();
