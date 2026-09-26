'use strict';
// Practice: listening drills on the twenty patterns, from real clips of his
// own videos (a clip is a line with a start and an end time).
//   /practice          — the twenty patterns in the patterns page's order,
//                        each with how many clips it has; Mix at the top.
//   /practice?p=<id>   — a round on one pattern; ?p=mix a round on all.
// For each clip: "hear it" plays it once with the line hidden ("play again"
// as often as he likes), then "What was said?" — three written lines, one
// real. Then the line as said, tinted, and the pattern named. In Mix,
// "Which pattern?" comes after, before the patterns are named. A round ends
// with how many he knew and the ones that got past him.
// Nothing is kept about a round once he leaves: no score history, no timer.
(function () {
  const { api, el, topBar, clock, saidNode, shakySet } = window.FE;
  document.getElementById('top').replaceWith(topBar('/practice'));
  const box = document.getElementById('content');
  const q = new URLSearchParams(location.search);
  const which = q.get('p');

  const STATE_WORDS = { shaky: 'shaky', seen: 'seen, no trouble yet', solid: 'solid', 'not-met': 'not met yet' };
  const NO_CLIPS = 'no clips yet — watch more videos';
  const clipsWord = (n) => (n ? n + (n === 1 ? ' clip' : ' clips') : NO_CLIPS);
  const fail = (err) => { document.getElementById('load-msg').textContent = err.message; };

  // --- the drills home -------------------------------------------------------

  function drawHome(data) {
    box.className = 'narrow stack';
    const entry = (href, name, sub, n, extra) => (n
      ? el('li', null, el('a', { class: 'item drill-entry' + (extra || ''), href }, [el('span', { class: 'name', text: name }), el('span', { class: 'sub', text: sub })]))
      : el('li', null, el('div', { class: 'item drill-entry off' + (extra || '') }, [el('span', { class: 'name', text: name }), el('span', { class: 'sub', text: sub })])));
    const list = el('ul', { class: 'list' });
    list.appendChild(entry('/practice?p=mix', 'Mix', data.mix ? 'every pattern, shaky ones more often · ' + clipsWord(data.mix) : NO_CLIPS, data.mix, ' mix'));
    for (const p of data.patterns) {
      list.appendChild(entry('/practice?p=' + encodeURIComponent(p.id), p.name, STATE_WORDS[p.state] + ' · ' + clipsWord(p.clips), p.clips, p.state === 'shaky' ? ' shaky' : ''));
    }
    box.append(
      el('h1', { class: 'title', text: 'Practice' }),
      el('p', { class: 'muted', style: 'margin:0', text: 'Hear a line from your own videos, then pick what was said. Choose a pattern, or Mix.' }),
      list,
    );
  }

  // --- a round ---------------------------------------------------------------

  let player = null, playerReady = false, loaded = null, stopAt = null, pendingPlay = null;
  let items = [], at = 0, byId = {}, shaky = new Set();
  let knew = 0, missed = [];

  function hideCaptions() {
    try { if (player && player.unloadModule) { player.unloadModule('captions'); player.unloadModule('cc'); } } catch (e) { /* not offered */ }
  }

  // Plays one clip once: from its start to its end, then stops.
  function play(clip) {
    if (!player || !playerReady) { pendingPlay = clip; return; }
    stopAt = clip.end_s;
    try {
      if (loaded !== clip.video.youtube_id) {
        loaded = clip.video.youtube_id;
        player.loadVideoById({ videoId: loaded, startSeconds: clip.start_s });
      } else {
        player.seekTo(clip.start_s, true);
        player.playVideo();
      }
    } catch (e) { /* ignore */ }
    hideCaptions();
  }

  // Stops at the clip's end. Only within three seconds past it: right after
  // a new video is loaded the clock can still read the old video's time.
  function tick() {
    if (!player || !playerReady || stopAt == null) return;
    let t;
    try { t = player.getCurrentTime(); } catch (e) { return; }
    if (typeof t === 'number' && t >= stopAt && t < stopAt + 3) {
      stopAt = null;
      try { player.pauseVideo(); } catch (e) { /* ignore */ }
    }
  }

  function startPlayer(first) {
    const spot = document.getElementById('player-el');
    const failTimer = setTimeout(() => {
      if (!playerReady) { spot.className = 'fallback'; spot.textContent = 'The video player did not load, so the clips cannot play. Try again later.'; }
    }, 10000);
    loaded = first.video.youtube_id;
    window.onYouTubeIframeAPIReady = function () {
      player = new window.YT.Player('player-el', {
        videoId: loaded,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, start: Math.floor(first.start_s), cc_load_policy: 0 },
        events: {
          onReady: () => {
            playerReady = true;
            clearTimeout(failTimer);
            hideCaptions();
            if (pendingPlay) { const c = pendingPlay; pendingPlay = null; play(c); }
          },
        },
      });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(failTimer); spot.className = 'fallback'; spot.textContent = 'The video player did not load, so the clips cannot play. Try again later.'; };
    document.head.appendChild(s);
    setInterval(tick, 200);
  }

  function answer(lineId, right) {
    api('POST', '/api/drills/answer', { line_id: lineId, right }).catch(() => {});
  }

  // Each pattern in the line: its name and what it does.
  function named(clip) {
    return el('ul', { class: 'why' }, clip.patterns.map((id) => {
      const p = byId[id] || { name: id, explain: '' };
      return el('li', null, [el('b', { text: p.name + (shaky.has(id) ? ' (shaky for you)' : '') }), p.explain ? ' — ' + p.explain : '']);
    }));
  }

  function asSaid(clip) {
    return el('div', { class: 'drill-line' }, [
      el('span', { class: 'label', text: 'as you heard it' }),
      saidNode(clip, shaky, 'said said-big'),
      el('span', { class: 'label', text: 'as written' }),
      el('span', { class: 'written-big', text: clip.written }),
    ]);
  }

  // A row of choice buttons. onPick(index) once; the buttons then show which
  // was right and which he picked.
  function choiceRow(labels, rightIdx, onPick) {
    const row = el('div', { class: 'choices', role: 'group' });
    const buttons = labels.map((label, i) => el('button', { type: 'button', class: 'choice', text: label, onclick: () => {
      for (const b of buttons) b.disabled = true;
      buttons[rightIdx].classList.add('right');
      if (i !== rightIdx) buttons[i].classList.add('wrong');
      buttons[i].setAttribute('aria-pressed', 'true');
      onPick(i);
    } }));
    row.append(...buttons);
    return row;
  }

  function verdict(right, words) {
    return el('p', { class: 'verdict ' + (right ? 'right' : 'wrong'), role: 'status', text: words });
  }

  function drawItem(autoplay) {
    const item = items[at];
    const clip = item.clip;
    const card = document.getElementById('card');
    card.textContent = '';
    const heard = { first: true };
    const hear = el('button', { type: 'button', class: 'primary hear', text: 'hear it' });
    const ask = el('div', { class: 'stack', hidden: true });
    const after = el('div', { class: 'stack' });
    const next = el('button', { type: 'button', class: 'primary', text: at + 1 < items.length ? 'next' : 'see how it went', hidden: true, onclick: () => {
      at++;
      if (at < items.length) drawItem(true); else drawEnd();
    } });
    hear.addEventListener('click', () => {
      play(clip);
      if (heard.first) { heard.first = false; hear.textContent = 'play again'; hear.className = 'secondary hear'; ask.hidden = false; }
    });
    card.append(
      el('div', { class: 'row-head' }, [el('span', { class: 'label', text: 'clip ' + (at + 1) + ' of ' + items.length }), el('span', { class: 'note', text: clip.video.title })]),
      hear, ask, after, next,
    );

    // "Which pattern?" — Mix only, after the line is shown: one of the
    // line's own patterns among four. Names the patterns once answered.
    // Records nothing.
    function whichPattern() {
      const ids = item.pattern_choices;
      const labels = ids.map((id) => (byId[id] ? byId[id].name : id));
      const own = ids.findIndex((id) => clip.patterns.includes(id));
      after.append(el('h2', { class: 'title q', text: 'Which pattern?' }), choiceRow(labels, own, (i) => {
        const v = verdict(i === own, i === own ? 'Yes, that one.' : 'Not that one.');
        after.append(v, named(clip));
        next.hidden = false;
        show(v);
      }));
    }

    // Brings what just appeared into view, under the player on a phone.
    function show(node) {
      try { node.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* old browser */ }
    }

    function reveal(right) {
      const v = right !== null ? verdict(right, right ? 'Knew it.' : 'Got past me.') : null;
      if (v) after.append(v);
      const line = asSaid(clip);
      after.append(line);
      if (item.pattern_choices) whichPattern();
      else { after.append(named(clip)); next.hidden = false; }
      show(line);
    }

    if (item.choices) {
      const rightIdx = item.choices.indexOf(clip.written);
      ask.append(el('h2', { class: 'title q', text: 'What was said?' }), choiceRow(item.choices, rightIdx, (i) => {
        const right = i === rightIdx;
        answer(clip.id, right);
        if (right) knew++; else missed.push(clip);
        item.answered = true;
        reveal(right);
      }));
    } else {
      // Too few lines in his videos to make wrong choices: nothing to ask
      // about the words; the line is shown when he asks for it.
      ask.append(el('button', { type: 'button', class: 'secondary', text: 'show the line', onclick: (e) => { e.target.remove(); reveal(null); } }));
    }
    if (autoplay) {
      show(card);
      play(clip);
      heard.first = false; hear.textContent = 'play again'; hear.className = 'secondary hear'; ask.hidden = false;
    }
  }

  function drawEnd() {
    stopAt = null;
    try { if (player && playerReady) player.pauseVideo(); } catch (e) { /* ignore */ }
    const card = document.getElementById('card');
    card.textContent = '';
    const asked = items.filter((it) => it.answered).length;
    const n = items.length;
    const head = n + (n === 1 ? ' clip' : ' clips') + (asked ? ', ' + knew + ' knew it, ' + missed.length + ' got past me' : '');
    card.append(el('h2', { class: 'title', text: head }));
    if (missed.length) {
      const list = el('ul', { class: 'list' });
      for (const c of missed) {
        list.appendChild(el('li', null, el('a', { class: 'kept-item', href: '/watch?id=' + c.video.id + '&line=' + c.idx }, [
          saidNode(c, shaky),
          el('span', { class: 'written', text: c.written }),
          el('span', { class: 'sub', text: c.video.title + ' · at ' + clock(c.start_s) }),
        ])));
      }
      card.append(el('p', { class: 'note', style: 'margin:0', text: 'These got past you. Tap one to open its video at that line.' }), list);
    } else if (asked) {
      card.append(el('p', { class: 'note', style: 'margin:0', text: 'Nothing got past you this round.' }));
    }
    card.append(el('div', { class: 'controls' }, [
      el('button', { type: 'button', class: 'primary', text: 'again', onclick: () => newRound() }),
      el('a', { class: 'secondary button-link', href: '/practice', text: 'all patterns' }),
    ]));
  }

  async function newRound() {
    const r = await api('GET', '/api/drills/round?pattern=' + encodeURIComponent(which)).catch(fail);
    if (!r) return;
    items = r.items; at = 0; knew = 0; missed = [];
    if (!items.length) {
      document.getElementById('card').replaceChildren(el('p', { class: 'nolines-say', text: NO_CLIPS }), el('a', { href: '/practice', text: 'all patterns' }));
      return;
    }
    if (!player && !document.getElementById('player-el').className) startPlayer(items[0].clip);
    drawItem(false);
  }

  async function drawRound() {
    const [list, pats] = await Promise.all([api('GET', '/api/pattern-list'), api('GET', '/api/patterns')]);
    for (const p of list.items) byId[p.id] = p;
    shaky = shakySet(pats);
    const name = which === 'mix' ? 'Mix' : byId[which] ? byId[which].name : which;
    box.className = 'drill';
    box.append(
      el('div', { class: 'watch-head' }, [
        el('a', { class: 'note', href: '/practice', text: '← all patterns' }),
        el('h1', { class: 'title', text: name }),
        which === 'mix' ? null : el('p', { class: 'note', style: 'margin:0', text: byId[which] ? byId[which].explain : '' }),
      ]),
      el('div', { class: 'player-wrap' }, el('div', { class: 'player' }, el('div', { id: 'player-el' }))),
      el('section', { class: 'panel stack drill-card', id: 'card', 'aria-live': 'polite' }),
    );
    await newRound();
  }

  if (which) drawRound().catch(fail);
  else api('GET', '/api/drills').then(drawHome).catch(fail);
})();
