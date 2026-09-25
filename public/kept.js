'use strict';
// Every kept line, newest first, with its video and time. Tapping one opens
// the watch page at that line (a line from a photo of the TV opens the photo).
(function () {
  const { api, el, topBar, clock, saidNode, shakySet } = window.FE;
  document.getElementById('top').replaceWith(topBar('/kept'));
  const box = document.getElementById('content');
  box.className = 'narrow stack';
  Promise.all([api('GET', '/api/kept'), api('GET', '/api/patterns')]).then(([kept, pats]) => {
    const shaky = shakySet(pats);
    box.append(
      el('h1', { class: 'title', text: 'Kept lines' }),
      el('p', { class: 'muted', style: 'margin:0', text: kept.items.length ? kept.items.length + (kept.items.length === 1 ? ' line' : ' lines') + ' you kept, newest first.' : 'No kept lines yet. Tap a line while you watch and press Keep.' }),
    );
    const list = el('ul', { class: 'list' });
    for (const k of kept.items) {
      // A kept line from an earlier paste has no line on the video any more:
      // it opens the video at the top.
      let where = k.video.youtube_id ? k.video.title + (k.start_s != null ? ' · at ' + clock(k.start_s) : '') : k.moment_id ? 'From the TV' : 'A line you typed';
      if (k.earlier) where += ' · from an earlier paste';
      const lineAt = k.video.youtube_id && !k.earlier ? '&line=' + k.idx : '';
      // A line from a photo of the TV opens the photo.
      const href = k.moment_id ? '/moment?id=' + k.moment_id : '/watch?id=' + k.video.id + lineAt;
      list.appendChild(el('li', null, el('a', { class: 'kept-item', href }, [
        saidNode(k, shaky),
        el('span', { class: 'written', text: k.written }),
        el('span', { class: 'sub', text: where }),
      ])));
    }
    box.appendChild(list);
  }).catch((err) => { document.getElementById('load-msg').textContent = err.message; });
})();
