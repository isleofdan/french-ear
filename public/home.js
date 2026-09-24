'use strict';
(function () {
  const { api, el, topBar } = window.FE;
  document.getElementById('top').replaceWith(topBar('/'));

  const linkForm = document.getElementById('link-form');
  const link = document.getElementById('link');
  const linkMsg = document.getElementById('link-msg');
  const linkGo = document.getElementById('link-go');
  const transcript = document.getElementById('transcript');

  // A link shared from another app (Android's Share -> French ear) lands here.
  const shared = new URLSearchParams(location.search).get('shared');
  if (shared) {
    const m = shared.match(/https?:\/\/\S+/);
    link.value = m ? m[0] : shared;
    history.replaceState(null, '', '/');
  }

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    linkMsg.textContent = '';
    linkGo.disabled = true;
    const pasted = transcript.value.trim();
    linkGo.textContent = pasted ? 'Reading your transcript…' : 'Reading the captions…';
    try {
      const v = await api('POST', '/api/videos', pasted ? { link: link.value, transcript: pasted } : { link: link.value });
      const t = v.start_s ? '&t=' + v.start_s : '';
      location.href = '/watch?id=' + v.id + t;
    } catch (err) {
      // YouTube wouldn't give the captions: the video's own page says so and
      // takes a pasted transcript.
      if (err.data && err.data.page) { location.href = err.data.page; return; }
      linkMsg.textContent = err.message;
      linkGo.disabled = false;
      linkGo.textContent = 'Show me the lines';
    }
  });

  const typedForm = document.getElementById('typed-form');
  const typed = document.getElementById('typed');
  const typedMsg = document.getElementById('typed-msg');
  const typedGo = document.getElementById('typed-go');
  typedForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    typedMsg.textContent = '';
    typedGo.disabled = true;
    typedGo.textContent = 'Working it out…';
    try {
      const v = await api('POST', '/api/typed', { text: typed.value });
      location.href = '/watch?id=' + v.id;
    } catch (err) {
      typedMsg.textContent = err.message;
      typedGo.disabled = false;
      typedGo.textContent = 'How is it said?';
    }
  });

  api('GET', '/api/home').then((home) => {
    document.getElementById('n-solid').textContent = home.totals.solid;
    document.getElementById('n-shaky').textContent = home.totals.shaky;
    document.getElementById('n-notmet').textContent = home.totals['not-met'];
    const list = document.getElementById('recent');
    if (!home.videos.length) {
      list.appendChild(el('li', { class: 'note', text: 'No videos yet. Paste a link above.' }));
      return;
    }
    for (const v of home.videos) {
      const c = v.counts;
      const bits = [c.total + ' lines'];
      if (c.pending) bits.push(c.pending + ' still being worked out');
      if (c.unworked) bits.push(c.unworked + ' not yet worked out');
      list.appendChild(el('li', null, el('a', { class: 'item', href: '/watch?id=' + v.id }, [
        el('span', { text: v.title }),
        el('span', { class: 'sub', text: bits.join(' · ') }),
      ])));
    }
  }).catch((err) => {
    document.getElementById('recent').appendChild(el('li', { class: 'msg', text: err.message }));
  });
})();
