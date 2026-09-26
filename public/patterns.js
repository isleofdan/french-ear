'use strict';
// Every pattern with where it stands for him: shaky first, then seen, solid,
// not met yet. The rule is in lib/tally.js and docs/DESIGN.md.
(function () {
  const { api, el, topBar } = window.FE;
  document.getElementById('top').replaceWith(topBar('/patterns'));
  const box = document.getElementById('content');
  box.className = 'stack';

  const GROUPS = [
    ['shaky', 'Shaky'],
    ['seen', 'Seen, no trouble yet'],
    ['solid', 'Solid'],
    ['not-met', 'Not met yet'],
  ];

  function countsLine(p) {
    const c = p.counts, bits = [];
    if (c.got_past_me) bits.push(c.got_past_me + ' got past me');
    if (c.keep) bits.push(c.keep + ' kept');
    if (c.watched_clean) bits.push('heard clean in ' + c.watched_clean + (c.watched_clean === 1 ? ' line' : ' lines'));
    if (c.drill_clean) bits.push('knew it in ' + c.drill_clean + (c.drill_clean === 1 ? ' drill line' : ' drill lines'));
    if (c.looked) bits.push(c.looked + ' looked at');
    return bits.join(' · ');
  }

  api('GET', '/api/patterns').then((data) => {
    box.append(
      el('div', { class: 'narrow stack', style: 'gap:4px;margin:0' }, [
        el('h1', { class: 'title', text: 'Your patterns' }),
        el('p', { class: 'muted', style: 'margin:0', text: 'Twenty ways spoken French differs from the page. Shaky first. A "got past me" counts for more than a look.' }),
      ]),
    );
    for (const [state, name] of GROUPS) {
      const mine = data.patterns.filter((p) => p.state === state);
      if (!mine.length) continue;
      box.appendChild(el('h2', { class: 'group-head ' + state, text: name + ' · ' + mine.length }));
      const grid = el('div', { class: 'patterns-grid' });
      for (const p of mine) {
        const sub = state === 'not-met' ? 'not met yet' : countsLine(p);
        grid.appendChild(el('details', { class: 'pattern' }, [
          el('summary', null, [
            el('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
              el('span', { class: 'name', text: p.name }),
              sub ? el('span', { class: 'sub', text: sub }) : null,
            ]),
            el('span', { class: 'dot ' + state, 'aria-hidden': 'true' }),
          ]),
          el('div', { class: 'more' }, [
            el('div', { text: p.explain }),
            ...p.examples.map((e) => el('div', { class: 'ex' }, [e.written + ' → ', el('mark', { class: 'tint', text: e.said })])),
          ]),
        ]));
      }
      box.appendChild(grid);
    }
  }).catch((err) => { document.getElementById('load-msg').textContent = err.message; });
})();
