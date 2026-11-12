// ==UserScript==
// @name         Minigram
// @description  Instagram без Reels, рекомендаций и бесконечной ленты
// @version      1.0.0
// @match        https://www.instagram.com/*
// @run-at       document-start
// @inject-into  auto
// @grant        none
// ==/UserScript==

// Один и тот же файл используется и как юзерскрипт для браузера,
// и как скрипт, который Android-приложение вставляет в страницу.
(function () {
  'use strict';
  if (window.__minigram) return;
  if (!/(^|\.)instagram\.com$/.test(location.hostname)) return;
  window.__minigram = true;

  // ---------- настройки ----------
  var KEY = 'minigram:settings';
  var settings = { pageSize: 10, hideFeedVideos: false };
  try {
    var stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (stored.pageSize >= 1) settings.pageSize = Math.min(50, stored.pageSize | 0);
    settings.hideFeedVideos = !!stored.hideFeedVideos;
  } catch (e) {}
  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
  }

  // Подписи, по которым пост в ленте считается рекламой или рекомендацией.
  // Сравнение — с полным текстом элемента, без учёта регистра.
  var JUNK_LABELS = [
    'sponsored', 'реклама',
    'suggested for you', 'рекомендации для вас', 'рекомендуем вам',
    'suggested post', 'suggested posts', 'рекомендуемые публикации',
    // кнопка «Подписаться» в шапке поста = автор не из ваших подписок
    'follow', 'подписаться'
  ];

  var limit = settings.pageSize; // сколько постов показываем сейчас
  var order = [];                // id постов из подписок в порядке появления

  // ---------- стили ----------
  var CSS = [
    // вкладка Reels в навигации
    'a[href="/reels/"],a[href^="/reels/?"]{display:none!important}',
    // сетка рекомендаций на странице поиска (сам поиск остаётся)
    'html.mg-explore main a[href^="/p/"],html.mg-explore main a[href^="/reel/"]{display:none!important}',
    '[data-mg="hide"]{display:none!important}',
    '#mg-bar{position:fixed;left:8px;right:8px;bottom:58px;z-index:2147483646;display:none;' +
      'align-items:center;gap:8px;padding:10px 12px;border-radius:14px;background:#111;color:#fff;' +
      'font:14px/1.3 system-ui,-apple-system,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35)}',
    '#mg-bar.mg-on{display:flex}',
    '#mg-bar span{flex:1}',
    '#mg-bar button,#mg-panel button{border:0;border-radius:9px;padding:8px 10px;background:#fff;color:#111;' +
      'font:600 13px system-ui,-apple-system,sans-serif}',
    '#mg-bar button.mg-ghost{background:#333;color:#fff}',
    '#mg-panel{position:fixed;inset:0;z-index:2147483647;display:none;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.5);font:15px/1.4 system-ui,-apple-system,sans-serif}',
    '#mg-panel.mg-on{display:flex}',
    '#mg-panel form{width:min(320px,86vw);padding:18px;border-radius:16px;background:#fff;color:#111;' +
      'display:flex;flex-direction:column;gap:14px}',
    '#mg-panel label{display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '#mg-panel input[type=number]{width:64px;padding:6px;font-size:15px;border:1px solid #bbb;border-radius:8px}',
    '#mg-panel button{background:#111;color:#fff;padding:10px}'
  ].join('\n');

  function addStyles() {
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
    } catch (e) {
      var style = document.createElement('style');
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // ---------- блокировка подгрузки ----------
  // Рекомендации и поток Reels не запрашиваем вовсе, а подгрузку ленты
  // останавливаем, когда загружено на одну «порцию» больше, чем показано.
  var ALWAYS_BLOCK = /discover\/web\/explore_grid|clips\/discover|fb_api_req_friendly_name=[^&]*(ExploreRoot|ExploreGrid|ClipsTab|ClipsPagination|ReelsTab)/i;
  var FEED_PAGING = /\/feed\/timeline|fb_api_req_friendly_name=[^&]*Feed[^&]*Pagination/i;

  function isBlocked(url, body) {
    var text = String(url || '');
    if (typeof body === 'string') text += ' ' + body;
    else if (body && typeof body.toString === 'function' && body instanceof URLSearchParams) text += ' ' + body;
    if (ALWAYS_BLOCK.test(text)) return true;
    return order.length >= limit + settings.pageSize && FEED_PAGING.test(text);
  }

  function patchNetwork() {
    var open = XMLHttpRequest.prototype.open;
    var send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__mgUrl = url;
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (isBlocked(this.__mgUrl, body)) {
        var xhr = this;
        setTimeout(function () {
          try { xhr.dispatchEvent(new ProgressEvent('error')); } catch (e) {}
          try { xhr.dispatchEvent(new ProgressEvent('loadend')); } catch (e) {}
        }, 0);
        return;
      }
      return send.apply(this, arguments);
    };
    if (window.fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = typeof input === 'string' ? input : (input && input.url);
        if (isBlocked(url, init && init.body)) return Promise.reject(new TypeError('Blocked by Minigram'));
        return origFetch.apply(this, arguments);
      };
    }
  }

  // ---------- лента ----------
  function postId(article) {
    var link = article.querySelector('a[href*="/p/"],a[href*="/reel/"]');
    var m = link && /\/(?:p|reel)\/([^/?#]+)/.exec(link.getAttribute('href') || '');
    return m ? m[1] : null;
  }

  function isJunk(article) {
    if (settings.hideFeedVideos && article.querySelector('video,a[href*="/reel/"]')) return true;
    var scope = article.querySelector('header') || article;
    var nodes = scope.querySelectorAll('span,a,button,div[role="button"]');
    var max = Math.min(nodes.length, 80);
    for (var i = 0; i < max; i++) {
      var el = nodes[i];
      if (el.childElementCount) continue;
      var text = (el.textContent || '').trim().toLowerCase();
      if (text && text.length < 40 && JUNK_LABELS.indexOf(text) !== -1) return true;
    }
    return false;
  }

  function setHidden(el, hidden) {
    if (hidden) {
      if (el.getAttribute('data-mg') !== 'hide') el.setAttribute('data-mg', 'hide');
    } else if (el.hasAttribute('data-mg')) {
      el.removeAttribute('data-mg');
    }
  }

  // Прячет блок ленты целиком (например, карусель «Рекомендации для вас»):
  // поднимаемся от элемента до соседа постов.
  function hideFeedBlock(el, main) {
    if (el.closest('article')) return;
    while (el.parentElement && el.parentElement !== main && !el.parentElement.querySelector('article')) {
      el = el.parentElement;
    }
    if (el.parentElement && el.parentElement !== main) setHidden(el, true);
  }

  var lastShown = null; // последний показанный пост — по нему решаем, когда показать плашку

  function scan() {
    scheduled = false;
    var root = document.documentElement;
    if (!root) return;
    var path = location.pathname;
    var home = path === '/';
    root.classList.toggle('mg-explore', /^\/explore\/?$/.test(path));
    lastShown = null;

    if (home) {
      var main = document.querySelector('main') || document.body;
      if (main) {
        var articles = main.querySelectorAll('article');
        for (var i = 0; i < articles.length; i++) {
          var article = articles[i];
          var id = postId(article);
          if (!id) continue;
          var index = order.indexOf(id);
          if (isJunk(article)) {
            if (index !== -1) order.splice(index, 1);
            setHidden(article, true);
            continue;
          }
          if (index === -1) index = order.push(id) - 1;
          setHidden(article, index >= limit);
          if (index === limit - 1) lastShown = article;
        }
        var people = main.querySelectorAll('a[href^="/explore/people"]');
        for (var j = 0; j < people.length; j++) hideFeedBlock(people[j], main);
      }
    }
    updateBar(home);
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(scan);
  }

  // ---------- интерфейс ----------
  var bar, barText, moreButton, panel, sizeInput, videoInput;

  function el(tag, props, children) {
    var node = document.createElement(tag);
    for (var k in props || {}) node[k] = props[k];
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function buildUi() {
    if (bar || !document.body) return;
    barText = el('span');
    moreButton = el('button', { type: 'button' });
    moreButton.addEventListener('click', function () {
      limit += settings.pageSize;
      scan();
      // подталкиваем страницу, чтобы она заметила освободившееся место
      window.scrollBy(0, 1);
      window.scrollBy(0, -1);
    });
    var reload = el('button', { type: 'button', className: 'mg-ghost', textContent: 'Обновить' });
    reload.addEventListener('click', function () { location.reload(); });
    var gear = el('button', { type: 'button', className: 'mg-ghost', textContent: '⚙' });
    gear.setAttribute('aria-label', 'Настройки Minigram');
    gear.addEventListener('click', function () {
      sizeInput.value = settings.pageSize;
      videoInput.checked = settings.hideFeedVideos;
      panel.classList.add('mg-on');
    });
    bar = el('div', { id: 'mg-bar' }, [barText, moreButton, reload, gear]);

    sizeInput = el('input', { type: 'number', min: '1', max: '50' });
    videoInput = el('input', { type: 'checkbox' });
    var form = el('form', {}, [
      el('strong', { textContent: 'Minigram' }),
      el('label', {}, [el('span', { textContent: 'Постов за один раз' }), sizeInput]),
      el('label', {}, [el('span', { textContent: 'Скрывать видео в ленте' }), videoInput]),
      el('button', { type: 'submit', textContent: 'Сохранить' })
    ]);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      settings.pageSize = Math.max(1, Math.min(50, parseInt(sizeInput.value, 10) || 10));
      settings.hideFeedVideos = videoInput.checked;
      saveSettings();
      limit = Math.max(limit, settings.pageSize);
      panel.classList.remove('mg-on');
      scan();
    });
    panel = el('div', { id: 'mg-panel' }, [form]);
    panel.addEventListener('click', function (event) {
      if (event.target === panel) panel.classList.remove('mg-on');
    });
    document.body.appendChild(bar);
    document.body.appendChild(panel);
  }

  function updateBar(home) {
    buildUi();
    if (!bar) return;
    var show = false;
    if (home && order.length >= limit && lastShown) {
      show = lastShown.getBoundingClientRect().bottom < window.innerHeight + 150;
    }
    if (show) {
      var text = 'Лента закончилась: ' + limit + ' из подписок';
      var more = 'Ещё ' + settings.pageSize;
      if (barText.textContent !== text) barText.textContent = text;
      if (moreButton.textContent !== more) moreButton.textContent = more;
    }
    if (bar.classList.contains('mg-on') !== show) bar.classList.toggle('mg-on', show);
  }

  // ---------- навигация ----------
  var lastPath = null;
  function checkRoute() {
    var path = location.pathname;
    if (/^\/reels\/?$/.test(path)) {
      location.replace('/');
      return;
    }
    if (path !== lastPath) {
      lastPath = path;
      schedule();
    }
  }

  // ---------- запуск ----------
  patchNetwork();
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function () {
      var result = original.apply(this, arguments);
      checkRoute();
      return result;
    };
  });
  window.addEventListener('popstate', checkRoute);
  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule);
  setInterval(checkRoute, 500);

  function start() {
    if (!document.documentElement) {
      setTimeout(start, 10);
      return;
    }
    addStyles();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    checkRoute();
    schedule();
  }
  start();
})();
