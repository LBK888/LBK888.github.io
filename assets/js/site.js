/* BK Lab homepage: language switch, the tool catalogue, publications,
 * the email coupon, the tissue readout and the motion layer. */
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var lang = root.dataset.lang === 'zh' ? 'zh' : 'en';
  var NEW_DAYS = 45;
  var catalog = null;
  var papers = null;
  var extra = [];   // tools found on GitHub that are not in catalog.json yet

  var T = {
    en: {
      toggle: '中文', toggleLabel: '切換為中文',
      browse: function (n) { return 'Browse ' + n + ' tools'; },
      count: function (n) { return n === 1 ? '1 tool' : n + ' tools'; },
      also: 'Also', fresh: 'New',
      lang: { zh: '中文', en: 'EN', 'zh,en': '中 / EN' },
      verdict: { clustered: 'This tissue is clustered', random: 'This tissue is randomly spaced', regular: 'This tissue is evenly spaced' },
      stats: function (s) {
        return 'Measured live: ' + s.cells + ' cells' + (s.added ? ' (' + s.added + ' added by you)' : '') +
          ' · Clark–Evans R ' + s.R.toFixed(2) + ' · ' + Math.round(s.hexagons * 100) + '% six-sided';
      },
      live: function (v) { return v + '.'; },
      catalogFail: 'The tool list could not be loaded here. Open the page through a web server, or browse the folders on GitHub.',
      allPapers: function (n) { return 'All ' + n + ' papers'; },
      subject: 'Message from the BK Lab website',
      title: 'BK Lab · How cells make patterns · National Taiwan Ocean University',
      from: 'From', role: 'I am',
    },
    zh: {
      toggle: 'EN', toggleLabel: 'Switch to English',
      browse: function (n) { return '瀏覽 ' + n + ' 個工具'; },
      count: function (n) { return n + ' 個'; },
      also: '另有', fresh: '新',
      lang: { zh: '中文', en: 'EN', 'zh,en': '中 / EN' },
      verdict: { clustered: '此刻組織呈聚集分布', random: '此刻組織呈隨機分布', regular: '此刻組織呈均勻分布' },
      stats: function (s) {
        return '即時測量：' + s.cells + ' 個細胞' + (s.added ? '（你加了 ' + s.added + ' 個）' : '') +
          ' · Clark–Evans R ' + s.R.toFixed(2) + ' · 六邊形 ' + Math.round(s.hexagons * 100) + '%';
      },
      live: function (v) { return v + '。'; },
      catalogFail: '這裡無法載入工具清單。請透過網頁伺服器開啟，或到 GitHub 瀏覽資料夾。',
      allPapers: function (n) { return '全部 ' + n + ' 篇論文'; },
      subject: '來自 BK Lab 網站的訊息',
      title: 'BK Lab · 細胞如何形成圖樣 · 國立臺灣海洋大學',
      from: '寄件人', role: '身分',
    },
  };
  function t(key) { return T[lang][key]; }
  function pick(obj) { return obj ? (obj[lang] || obj.en || obj.zh || '') : ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---- language ----------------------------------------------------------

  function setLang(next, save) {
    lang = next;
    root.dataset.lang = next;
    root.lang = next === 'zh' ? 'zh-Hant' : 'en';
    if (save) { try { localStorage.setItem('bklab-lang', next); } catch (e) {} }
    var btn = document.querySelector('.lang-toggle');
    if (btn) { btn.textContent = t('toggle'); btn.setAttribute('aria-label', t('toggleLabel')); }
    document.title = t('title');
    document.querySelectorAll('[data-ph-en]').forEach(function (el) {
      el.placeholder = el.getAttribute('data-ph-' + next) || el.getAttribute('data-ph-en');
    });
    document.querySelectorAll('[data-alt-en]').forEach(function (el) {
      el.alt = el.getAttribute('data-alt-' + next) || el.getAttribute('data-alt-en');
    });
    document.querySelectorAll('option[data-en]').forEach(function (el) {
      el.textContent = el.getAttribute('data-' + next) || el.getAttribute('data-en');
    });
    renderCatalog();
    renderPapers();
    if (lastStats) showStats(lastStats);
  }

  // ---- catalogue ---------------------------------------------------------

  function isNew(item) {
    if (!item.added) return !!item.discovered;
    var d = new Date(item.added + 'T00:00:00');
    return (Date.now() - d.getTime()) / 864e5 <= NEW_DAYS;
  }

  function thumb(item) {
    var src = item.thumb || item.cover;
    if (src) {
      return '<img class="item-thumb" src="' + esc(src) + '" alt="" width="72" height="72" loading="lazy" decoding="async">';
    }
    // No picture yet: a framed block of the page's ink, so a new folder still looks deliberate.
    return '<span class="item-thumb item-thumb-blank" aria-hidden="true"></span>';
  }

  function itemHTML(item) {
    var name = pick(item.title);
    var desc = pick(item.description);
    var needs = pick(item.needs);
    var marker = (T[lang].lang[item.lang] || '');
    var pages = (item.pages || []).map(function (p) {
      return '<a href="' + esc(p.href) + '">' + esc(pick(p.title)) + '</a>';
    }).join('<span aria-hidden="true"> · </span>');
    return '<li class="item">' +
      '<a class="item-link" href="' + esc(item.href) + '">' +
        thumb(item) +
        '<span class="item-name">' + esc(name) + (isNew(item) ? ' <span class="item-new">' + t('fresh') + '</span>' : '') + '</span>' +
        (marker ? '<span class="item-lang">' + esc(marker) + '</span>' : '') +
        (desc ? '<span class="item-desc">' + esc(desc) + '</span>' : '') +
        (needs ? '<span class="item-needs">' + esc(needs) + '</span>' : '') +
      '</a>' +
      (pages ? '<p class="item-pages"><span>' + t('also') + ':</span> ' + pages + '</p>' : '') +
    '</li>';
  }

  function categories() {
    if (!catalog) return [];
    return catalog.categories.map(function (c) {
      var found = extra.filter(function (x) { return x.category === c.id; });
      return Object.assign({}, c, { items: c.items.concat(found) });
    });
  }

  function renderCatalog() {
    var host = document.getElementById('catalog');
    if (!host || !catalog) return;
    var cats = categories();
    var total = 0;
    host.innerHTML = cats.map(function (c) {
      total += c.items.length;
      return '<section class="cat" id="cat-' + esc(c.id) + '" aria-labelledby="cat-' + esc(c.id) + '-h" data-reveal>' +
        '<header class="cat-head">' +
          '<h3 id="cat-' + esc(c.id) + '-h">' + esc(pick(c.name)) + '</h3>' +
          '<p class="cat-count">' + esc(t('count')(c.items.length)) + '</p>' +
        '</header>' +
        (pick(c.blurb) ? '<p class="cat-blurb">' + esc(pick(c.blurb)) + '</p>' : '') +
        '<ul class="cat-items">' + c.items.map(itemHTML).join('') + '</ul>' +
      '</section>';
    }).join('');

    var jump = document.querySelector('.tools-jump');
    if (jump) {
      jump.innerHTML = cats.map(function (c) {
        return '<a href="#cat-' + esc(c.id) + '">' + esc(pick(c.name)) + ' <span>' + c.items.length + '</span></a>';
      }).join('');
    }
    document.querySelectorAll('[data-tool-count]').forEach(function (el) { el.textContent = t('browse')(total); });
    document.querySelectorAll('[data-footer-cats]').forEach(function (el) {
      el.innerHTML = cats.map(function (c) { return '<li><a href="#cat-' + esc(c.id) + '">' + esc(pick(c.name)) + '</a></li>'; }).join('');
    });
    observe(host);
  }

  function loadCatalog() {
    return fetch('data/catalog.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { catalog = data; renderCatalog(); discover(); })
      .catch(function () {
        var host = document.getElementById('catalog');
        if (host) host.innerHTML = '<p class="catalog-fail">' + esc(t('catalogFail')) + '</p>';
      });
  }

  // A folder added on GitHub appears even before the catalogue is rebuilt:
  // ask GitHub for the file tree, and read the title of anything not yet listed.
  function discover() {
    if (!catalog || !catalog.repo || location.protocol === 'file:') return;
    var KEY = 'bklab-tree', MAX_AGE = 30 * 60 * 1000;
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    var tree = cached && Date.now() - cached.at < MAX_AGE
      ? Promise.resolve(cached.paths)
      : fetch('https://api.github.com/repos/' + catalog.repo + '/git/trees/' + (catalog.branch || 'main') + '?recursive=1')
          .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
          .then(function (j) {
            var paths = (j.tree || []).filter(function (n) { return n.type === 'blob' && /\.html?$/i.test(n.path); }).map(function (n) { return n.path; });
            try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), paths: paths })); } catch (e) {}
            return paths;
          });

    tree.then(function (paths) {
      var known = {};
      catalog.categories.forEach(function (c) { c.items.forEach(function (i) { known[i.id] = true; }); });
      var folders = {};
      catalog.categories.forEach(function (c) { folders[c.folder] = c.id; });
      var todo = [];
      paths.forEach(function (p) {
        var m = p.match(/^([^/]+)\/([^/]+)\/index\.html?$/i) || p.match(/^([^/]+)\/([^/]+\.html?)$/i);
        if (!m || !folders[m[1]] || /^[._]/.test(m[2]) || /^index\.html?$/i.test(m[2])) return;
        var slug = m[2].replace(/\.html?$/i, '');
        var id = folders[m[1]] + '/' + slug;
        if (known[id]) return;
        known[id] = true;
        var href = /\.html?$/i.test(m[2]) ? m[1] + '/' + m[2] : m[1] + '/' + m[2] + '/';
        todo.push({ id: id, slug: slug, category: folders[m[1]], href: href, path: p });
      });
      return Promise.all(todo.map(function (x) {
        return fetch(x.path).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
          if (!html) return null;
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var title = (doc.querySelector('title') || {}).textContent || x.slug.replace(/[-_]+/g, ' ');
          var d = doc.querySelector('meta[name="description"]');
          var desc = d ? d.getAttribute('content') : '';
          var base = x.href.replace(/[^/]*$/, '');
          return {
            id: x.id, slug: x.slug, category: x.category, href: x.href, discovered: true,
            title: { en: title.trim(), zh: title.trim() }, description: { en: desc, zh: desc }, needs: { en: '', zh: '' },
            thumb: /\/$/.test(x.href) && paths.indexOf(base + 'thumb.webp') >= 0 ? base + 'thumb.webp' : '',
            cover: '', pages: [],
          };
        }).catch(function () { return null; });
      }));
    }).then(function (found) {
      found = (found || []).filter(Boolean);
      if (found.length) { extra = found; renderCatalog(); }
    }).catch(function () { /* offline or rate-limited: the catalogue alone is fine */ });
  }

  // ---- publications ------------------------------------------------------

  function authorsHTML(a) { return esc(a).replace(/Liao BK/g, '<strong>Liao BK</strong>'); }

  function renderPapers() {
    if (!papers) return;
    var board = document.getElementById('pub-tiles');
    var list = document.getElementById('pub-list');
    var seen = {};
    var featured = papers.filter(function (p) {
      if (!p.featured || seen[p.journal]) return false;
      seen[p.journal] = true; return true;
    }).slice(0, 10);
    if (board) {
      board.innerHTML = featured.map(function (p, i) {
        return '<a class="pub-tile" style="--tile:var(--tile-' + (i % 4 + 1) + ')" href="https://doi.org/' + esc(p.doi) + '">' +
          '<span class="pub-journal">' + esc(p.journal) + '</span>' +
          '<span class="pub-meta"><span class="pub-year">' + p.year + '</span> ' + esc(p.title) + '</span>' +
        '</a>';
      }).join('');
    }
    if (list) {
      var years = [];
      papers.forEach(function (p) { if (years.indexOf(p.year) < 0) years.push(p.year); });
      list.innerHTML = years.map(function (y) {
        return '<li class="pub-year-group"><h4>' + y + '</h4><ol>' + papers.filter(function (p) { return p.year === y; }).map(function (p) {
          return '<li class="pub-entry">' +
            '<a class="pub-title" href="https://doi.org/' + esc(p.doi) + '" lang="en">' + esc(p.title) + '</a>' +
            '<span class="pub-authors" lang="en">' + authorsHTML(p.authors) + '</span>' +
            '<span class="pub-where" lang="en"><em>' + esc(p.journal) + '</em> ' + esc(p.cite) + '</span>' +
          '</li>';
        }).join('') + '</ol></li>';
      }).join('');
    }
    document.querySelectorAll('[data-paper-count]').forEach(function (el) { el.textContent = t('allPapers')(papers.length); });
  }

  function loadPapers() {
    return fetch('data/publications.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { papers = data.papers || []; renderPapers(); observe(document.getElementById('publications')); })
      .catch(function () {});
  }

  // ---- tissue readout ----------------------------------------------------

  var lastStats = null, lastVerdict = '';
  function showStats(s) {
    lastStats = s;
    var v = document.querySelector('[data-verdict]');
    var st = document.querySelector('[data-stats]');
    var live = document.querySelector('[data-live]');
    var word = T[lang].verdict[s.verdict];
    if (v) v.textContent = word;
    if (st) st.textContent = t('stats')(s);
    if (live && s.verdict !== lastVerdict) { live.textContent = t('live')(word); }
    lastVerdict = s.verdict;
    var panel = document.querySelector('.readout');
    if (panel) panel.dataset.state = s.verdict;
  }

  function wireField() {
    if (!window.labField) return;
    window.labField.onStats(showStats);
    document.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (window.labField[act]) window.labField[act]();
      });
    });
  }

  // ---- coupon: writes an email ------------------------------------------

  function wireCoupon() {
    var form = document.querySelector('.coupon');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements;
      var name = (f.name.value || '').trim();
      var role = f.role.options[f.role.selectedIndex].textContent.trim();
      var subject = (f.subject.value || '').trim() || t('subject');
      var body = (f.body.value || '').trim();
      var text = body + '\n\n— ' + t('from') + ': ' + (name || '-') + '\n' + t('role') + ': ' + role;
      window.location.href = 'mailto:' + form.getAttribute('data-to') +
        '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);
    });
  }

  // ---- motion: section entrances -----------------------------------------

  var io = null;
  function observe(scope) {
    if (!scope) return;
    var els = scope.matches && scope.matches('[data-reveal]') ? [scope] : [];
    els = els.concat(Array.prototype.slice.call(scope.querySelectorAll('[data-reveal]')));
    els.forEach(function (el) {
      if (el.dataset.revealReady) return;
      el.dataset.revealReady = '1';
      Array.prototype.forEach.call(el.querySelectorAll('[data-step], .cat-head, .cat-blurb, .item, .pub-tile, .pub-year-group'), function (c, i) {
        c.style.setProperty('--d', Math.min(i, 12) * 70 + 'ms');
      });
      if (!io) { el.classList.add('is-in'); return; }
      io.observe(el);
    });
  }

  function wireMotion() {
    root.classList.add('js');
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    }
    observe(document);

    // Slow crossfade: the shaped picture in the people panel cycles through its frames.
    var stack = document.querySelector('[data-crossfade]');
    if (stack) {
      var frames = stack.querySelectorAll('img, video');
      var i = 0;
      setInterval(function () {
        if (document.hidden || reduce.matches || frames.length < 2) return;
        frames[i].classList.remove('is-on');
        i = (i + 1) % frames.length;
        frames[i].classList.add('is-on');
      }, 5600);
    }

    // The heartbeat clip rests on its first frame for readers who asked for less motion.
    document.querySelectorAll('video[autoplay]').forEach(function (v) {
      function sync() { if (reduce.matches) { v.pause(); } else { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }
      sync();
      reduce.addEventListener && reduce.addEventListener('change', sync);
    });
  }

  // ---- start ---------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.querySelector('.lang-toggle');
    if (btn) btn.addEventListener('click', function () { setLang(lang === 'zh' ? 'en' : 'zh', true); });
    wireMotion();
    setLang(lang, false);
    wireField();
    wireCoupon();
    loadCatalog();
    loadPapers();
  });
})();
