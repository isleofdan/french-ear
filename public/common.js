'use strict';
// Shared by every page: the JSON helper, the top bar, time formatting, and
// how one line is drawn with its changed parts tinted.
(function () {
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    if (res.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Sign in first.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || ('The server answered ' + res.status + '.'));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // Screenshots of the transcript and the video's link, sent as a form.
  // `shared` is the token of screenshots shared in from another app. On
  // success the answer's `read` (the lines from each picture) is kept for the
  // watch page's "Here's how I read your screenshots".
  async function sendPictures(link, files, shared) {
    const form = new FormData();
    form.append('link', link || '');
    if (shared) form.append('shared', shared);
    for (const f of files || []) form.append('screenshots', f, f.name);
    const res = await fetch('/api/screenshots', { method: 'POST', body: form, headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (res.status === 401) {
      location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
      throw new Error('Sign in first.');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || (res.status === 413 ? 'Those pictures are too big to send in one go. Send fewer at a time.' : 'The server answered ' + res.status + '.'));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    try { sessionStorage.setItem('french-ear.read.' + data.id, JSON.stringify(data.read)); } catch (e) { /* no storage: the page says less */ }
    return data;
  }

  // The "Add screenshots of the transcript" control: the picker, and a line
  // saying how many are added. `extra` is a count already held (shared in).
  function picturePicker(input, picked, onChange, extra) {
    const say = () => {
      const n = input.files.length + (extra ? extra() : 0);
      picked.hidden = !n;
      picked.textContent = n === 1 ? '1 screenshot added.' : n + ' screenshots added.';
      if (onChange) onChange(n);
    };
    input.addEventListener('change', say);
    say();
    return say;
  }

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of [].concat(children || [])) {
      if (c == null || c === false) continue;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }

  function topBar(current) {
    const links = [['/', 'Home'], ['/kept', 'Kept'], ['/patterns', 'Your patterns']];
    return el('header', { class: 'top' }, [
      el('a', { class: 'brand', href: '/' , text: 'French ear' }),
      el('nav', { 'aria-label': 'Pages' }, links.map(([href, name]) =>
        el('a', { href, 'aria-current': href === current ? 'page' : null, text: name }))),
    ]);
  }

  function clock(s) {
    if (s == null || !isFinite(s)) return '';
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h ? h + ':' + two(m) + ':' + two(sec) : m + ':' + two(sec);
  }

  // The spoken line with its spans tinted. `shaky` is a Set of pattern ids
  // that are shaky for him: a span of one of those is orange.
  function saidNode(line, shaky, className) {
    const text = line.spoken != null ? line.spoken : line.written;
    const node = el('span', { class: className || 'said' });
    const spans = line.spans || [];
    if (!spans.length) { node.textContent = text; return node; }
    const cuts = new Set([0, text.length]);
    for (const s of spans) { cuts.add(s.start); cuts.add(s.end); }
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const piece = text.slice(a, b);
      const covering = spans.filter((s) => s.start <= a && s.end >= b);
      if (!covering.length) { node.appendChild(document.createTextNode(piece)); continue; }
      const isShaky = covering.some((s) => shaky && shaky.has(s.pattern));
      node.appendChild(el('mark', { class: 'tint' + (isShaky ? ' shaky' : ''), 'data-patterns': covering.map((s) => s.pattern).join(' '), text: piece }));
    }
    return node;
  }

  function shakySet(patternsAnswer) {
    return new Set((patternsAnswer.patterns || []).filter((p) => p.state === 'shaky').map((p) => p.id));
  }

  window.FE = { api, sendPictures, picturePicker, el, topBar, clock, saidNode, shakySet };

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }
})();
