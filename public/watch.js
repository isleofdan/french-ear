'use strict';
// The watch page: YouTube's own player on top, the lines under it.
//   Follow along — the lines show; the current one is highlighted and kept in
//     view. Tapping a line flips it to the written text and names its
//     patterns; that records one "looked" per pattern (once per line per visit).
//   Ear first — the lines are hidden. "What was that?" shows the last two and
//     records "got past me" for their patterns. A line that plays through
//     without being covered by a "What was that?" records "watched clean".
// A typed line (a video with no YouTube id) shows as one open line, no player,
// and records nothing except a keep.
// Lines pasted from YouTube's transcript panel show the first three as read
// ("Here's how I read your paste"); pasted with no timings, they are a plain
// list that does not follow the clock, and Ear first is not offered.
// Lines read out of screenshots of the transcript show the same way ("Here's
// how I read your screenshots"), with how many lines came from each picture.
// Any YouTube video takes a new paste or new screenshots ("Add the transcript
// again"), which replace its lines.
// /watch?yt=<YouTube id> is a video YouTube wouldn't give the captions for:
// nothing saved yet, the player, why, a box for the transcript, and "Try
// YouTube again".
(function () {
  const { api, sendPictures, picturePicker, el, topBar, clock, saidNode, shakySet } = window.FE;
  document.getElementById('top').replaceWith(topBar(''));

  const q = new URLSearchParams(location.search);
  const videoId = Number(q.get('id'));
  const ytId = /^[A-Za-z0-9_-]{11}$/.test(q.get('yt') || '') ? q.get('yt') : null;
  const MODE_KEY = 'french-ear.mode';

  let video = null;
  let byId = {};            // pattern id -> { name, explain }
  let shaky = new Set();    // pattern ids shaky for him
  let lines = [];           // the video's lines, by idx
  const nodes = new Map();  // idx -> <li>
  let player = null;
  let playerReady = false;
  let currentIdx = -1;
  let stopAt = null;
  let lastUserScroll = 0;
  let filter = null;        // pattern id the list is narrowed to
  let mode = 'follow';
  let timed = true;         // false: pasted lines with no timings
  try { if (localStorage.getItem(MODE_KEY) === 'ear') mode = 'ear'; } catch (e) { /* no storage: Follow along */ }

  // What has been recorded this visit, so nothing is counted twice.
  const looked = new Set();
  const flagged = new Set();   // got past me
  const played = new Set();    // lines heard playing in Ear first
  const finished = new Set();  // ... and played through
  const clean = new Set();     // watched clean, sent

  const $ = (id) => document.getElementById(id);

  function send(kind, ids) {
    const lineIds = ids.map((i) => lines[i]).filter((l) => l && l.patterns.length).map((l) => l.id);
    if (!lineIds.length) return;
    api('POST', '/api/events', { kind, line_ids: lineIds }).catch(() => {});
  }

  // --- drawing a line --------------------------------------------------------

  function why(line) {
    if (line.status === 'pending') return el('p', { class: 'note', text: 'Still working out how this line is said.' });
    if (line.status === 'unworked') return el('p', { class: 'note', text: 'Not yet worked out. Use "try again" at the top of the page.' });
    if (!line.spans.length) return el('p', { class: 'note', text: 'Said as written — nothing here changes in speech.' });
    const seen = new Set();
    const items = [];
    for (const s of line.spans) {
      const key = s.pattern + ':' + s.start;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = byId[s.pattern] || { name: s.pattern, explain: '' };
      items.push(el('li', null, [
        el('span', { class: 'frag', text: '“' + line.spoken.slice(s.start, s.end) + '” ' }),
        el('b', { text: p.name + (shaky.has(s.pattern) ? ' (shaky for you)' : '') }),
        ' — ' + p.explain,
      ]));
    }
    return el('ul', { class: 'why' }, items);
  }

  function keepButton(line) {
    const b = el('button', { type: 'button', class: 'secondary small', 'aria-pressed': line.kept ? 'true' : 'false', text: line.kept ? 'Kept' : 'Keep' });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = line.kept ? await api('DELETE', '/api/lines/' + line.id + '/keep') : await api('POST', '/api/lines/' + line.id + '/keep');
        line.kept = r.kept;
        for (const other of document.querySelectorAll('[data-keep="' + line.id + '"]')) {
          other.setAttribute('aria-pressed', line.kept ? 'true' : 'false');
          other.textContent = line.kept ? 'Kept' : 'Keep';
        }
      } catch (err) { alert(err.message); }
      b.disabled = false;
    });
    b.setAttribute('data-keep', line.id);
    return b;
  }

  function controls(line) {
    const bits = [];
    if (video.youtube_id && line.start_s != null) {
      bits.push(el('button', { type: 'button', class: 'secondary small', text: 'Play this line', onclick: () => replay(line) }));
    }
    if (line.status === 'worked') bits.push(keepButton(line));
    return el('div', { class: 'controls' }, bits);
  }

  function saidPart(line) {
    if (line.status === 'worked') return saidNode(line, shaky, 'said said-text');
    const note = line.status === 'pending' ? 'working out how it’s said…' : 'not yet worked out';
    return el('span', { class: 'said-text' }, [el('span', { class: 'said', text: line.written }), ' ', el('span', { class: 'state', text: note })]);
  }

  function lineNode(line, { open = false, where = 'list' } = {}) {
    const hasShaky = line.patterns.some((p) => shaky.has(p));
    const li = el('li', { class: 'line' + (hasShaky ? ' has-shaky' : '') + (open ? ' open' : ''), 'data-idx': line.idx });
    if (where === 'list') li.id = 'line-' + line.idx;
    const detail = el('div', { class: 'line-detail', hidden: !open }, [why(line), controls(line)]);
    const main = el('button', { type: 'button', class: 'line-main', 'aria-expanded': open ? 'true' : 'false' }, [
      el('span', { class: 'time', text: clock(line.start_s) }),
      el('span', { class: 'written', text: line.written }),
      saidPart(line),
    ]);
    main.addEventListener('click', () => {
      const nowOpen = !li.classList.contains('open');
      li.classList.toggle('open', nowOpen);
      detail.hidden = !nowOpen;
      main.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      if (nowOpen && where === 'list' && mode === 'follow' && line.status === 'worked' && !looked.has(line.idx)) {
        looked.add(line.idx);
        send('looked', [line.idx]);
      }
    });
    li.append(main, detail);
    return li;
  }

  function drawLines() {
    const list = $('lines');
    list.textContent = '';
    nodes.clear();
    for (const line of lines) {
      const li = lineNode(line);
      if (filter && !line.patterns.includes(filter)) li.hidden = true;
      nodes.set(line.idx, li);
      list.appendChild(li);
    }
    if (currentIdx >= 0 && nodes.get(currentIdx)) nodes.get(currentIdx).classList.add('current');
  }

  // Lines whose state changed since the last look are drawn again, each
  // keeping whether it was open.
  function updateLines(fresh) {
    for (const line of fresh) {
      const old = lines[line.idx];
      if (old && old.status === line.status && old.spoken === line.spoken && old.kept === line.kept) continue;
      lines[line.idx] = line;
      const was = nodes.get(line.idx);
      if (!was) continue;
      const li = lineNode(line, { open: was.classList.contains('open') });
      li.hidden = was.hidden;
      if (was.classList.contains('current')) li.classList.add('current');
      was.replaceWith(li);
      nodes.set(line.idx, li);
    }
  }

  // --- the status line -------------------------------------------------------

  function drawStatus() {
    const box = $('status');
    const c = video.counts;
    box.textContent = '';
    box.classList.remove('warn');
    if (c.pending > 0) {
      box.hidden = false;
      box.append('Working out how these lines sound — ' + (c.worked + c.unworked) + ' of ' + c.total + ' done. The written lines are all here now.');
      return;
    }
    if (c.unworked > 0) {
      box.hidden = false;
      box.classList.add('warn');
      const b = el('button', { type: 'button', class: 'secondary small', text: 'Try again' });
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { video = await api('POST', '/api/videos/' + video.id + '/retry'); drawStatus(); poll(); } catch (err) { alert(err.message); b.disabled = false; }
      });
      box.append(c.unworked + (c.unworked === 1 ? ' line' : ' lines') + ' not yet worked out — ', b);
      return;
    }
    box.hidden = true;
  }

  let polling = null;
  function poll() {
    if (polling) return;
    polling = setInterval(async () => {
      try {
        const fresh = await api('GET', '/api/videos/' + video.id);
        video = fresh;
        updateLines(fresh.lines);
        drawStatus();
        drawEpisode();
        if (!fresh.counts.pending && !fresh.working) { clearInterval(polling); polling = null; }
      } catch (e) { /* try again next tick */ }
    }, 3000);
  }

  // --- the laptop side panel -------------------------------------------------

  function drawEpisode() {
    const counts = {};
    for (const l of lines) for (const p of l.patterns) counts[p] = (counts[p] || 0) + 1;
    const ids = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const list = $('episode');
    list.textContent = '';
    if (!ids.length) list.appendChild(el('li', { class: 'note', text: 'Nothing worked out yet.' }));
    for (const id of ids) {
      const b = el('button', { type: 'button', 'aria-pressed': filter === id ? 'true' : 'false' }, [
        el('span', { class: shaky.has(id) ? 'shaky' : '', text: (byId[id] || {}).name || id }),
        el('span', { class: 'n', text: String(counts[id]) }),
      ]);
      b.addEventListener('click', () => setFilter(filter === id ? null : id));
      list.appendChild(el('li', null, b));
    }
    const mine = ids.filter((id) => shaky.has(id));
    $('shaky-box').hidden = !mine.length;
    if (mine.length) {
      const t = $('shaky-text');
      t.textContent = '';
      for (const id of mine) {
        const row = el('div', { style: 'display:flex;flex-direction:column;align-items:flex-start;gap:6px;margin-bottom:10px' }, [
          el('span', null, [el('b', { text: byId[id].name }), ' shows up in ' + counts[id] + (counts[id] === 1 ? ' line' : ' lines') + ' here.']),
        ]);
        row.appendChild(el('button', { type: 'button', class: 'secondary small', text: 'Show those lines', onclick: () => setFilter(id) }));
        t.appendChild(row);
      }
    }
  }

  function setFilter(id) {
    filter = id;
    const note = $('filter-note');
    let n = 0;
    for (const [idx, li] of nodes) {
      li.hidden = Boolean(id) && !lines[idx].patterns.includes(id);
      if (!li.hidden) n++;
    }
    note.hidden = !id;
    note.textContent = '';
    if (id) {
      note.append('Showing the ' + n + ' lines with “' + byId[id].name + '”. ');
      note.appendChild(el('button', { type: 'button', class: 'secondary small', text: 'Show all lines', onclick: () => setFilter(null) }));
      if (mode === 'ear') setMode('follow');
    }
    drawEpisode();
  }

  // --- modes -----------------------------------------------------------------

  function setMode(m) {
    if (m === mode && document.body.dataset.mode) return;
    if (mode === 'ear' && m === 'follow') flushClean(true);
    mode = m;
    document.body.dataset.mode = m;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* remembered for this page only */ }
    for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false');
    $('ear').hidden = m !== 'ear';
    $('lines').hidden = m === 'ear';
    $('filter-note').hidden = m === 'ear' || !filter;
    if (m === 'ear') {
      $('revealed').textContent = '';
      hideCaptions();
    }
  }

  function hideCaptions() {
    try { if (player && player.unloadModule) { player.unloadModule('captions'); player.unloadModule('cc'); } } catch (e) { /* not offered */ }
  }

  // The last two lines that have started by now.
  function lastTwo() {
    if (currentIdx < 0) return [];
    return [currentIdx - 1, currentIdx].filter((i) => i >= 0);
  }

  function whatWasThat() {
    const idxs = lastTwo();
    const box = $('revealed');
    box.textContent = '';
    if (!idxs.length) {
      box.appendChild(el('li', { class: 'note', text: 'Nothing has been said yet. Play the video first.' }));
      return;
    }
    try { if (player && playerReady) player.pauseVideo(); } catch (e) { /* ignore */ }
    const fresh = idxs.filter((i) => !flagged.has(i));
    for (const i of idxs) {
      flagged.add(i);
      box.appendChild(lineNode(lines[i], { open: true, where: 'revealed' }));
    }
    for (const node of box.querySelectorAll('.line')) {
      // shown open: the "as said" line and the written one both
      node.querySelector('.said-text').style.display = 'block';
    }
    send('got_past_me', fresh);
  }

  // Lines played through in Ear first that no "What was that?" can still
  // cover (older than the last two) are sent as watched clean. `all` sends
  // every one played through, on leaving the page or the mode.
  function flushClean(all) {
    const cover = new Set(lastTwo());
    const out = [];
    for (const i of finished) {
      if (clean.has(i) || flagged.has(i)) continue;
      if (!all && cover.has(i)) continue;
      clean.add(i);
      out.push(i);
    }
    if (out.length) send('watched_clean', out);
    return out;
  }

  function flushOnLeave() {
    if (mode !== 'ear') return;
    const out = [];
    for (const i of finished) if (!clean.has(i) && !flagged.has(i)) { clean.add(i); out.push(i); }
    const ids = out.map((i) => lines[i]).filter((l) => l.patterns.length).map((l) => l.id);
    if (!ids.length) return;
    try {
      navigator.sendBeacon('/api/events', new Blob([JSON.stringify({ kind: 'watched_clean', line_ids: ids })], { type: 'application/json' }));
    } catch (e) { /* lost; nothing else to do */ }
  }

  // --- the player ------------------------------------------------------------

  function lineAt(t) {
    let lo = 0, hi = lines.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lines[mid].start_s <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }

  function setCurrent(idx) {
    if (idx === currentIdx) return;
    const old = nodes.get(currentIdx);
    if (old) old.classList.remove('current');
    currentIdx = idx;
    const li = nodes.get(idx);
    if (!li) return;
    li.classList.add('current');
    if (mode === 'follow' && !li.hidden && Date.now() - lastUserScroll > 5000) {
      li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function tick() {
    if (!player || !playerReady) return;
    let t, state;
    try { t = player.getCurrentTime(); state = player.getPlayerState(); } catch (e) { return; }
    if (typeof t !== 'number') return;
    if (!timed) { if (stopAt != null && t >= stopAt) stopAt = null; return; }
    setCurrent(lineAt(t));
    if (stopAt != null && t >= stopAt) { stopAt = null; try { player.pauseVideo(); } catch (e) { /* ignore */ } }
    if (mode === 'ear' && state === 1) {
      const cur = lines[currentIdx];
      if (cur && t <= cur.end_s) played.add(currentIdx);
      for (const i of played) if (!finished.has(i) && t >= lines[i].end_s) finished.add(i);
      flushClean(false);
    }
  }

  function replay(line) {
    if (!player || !playerReady) return;
    stopAt = line.end_s;
    try { player.seekTo(line.start_s, true); player.playVideo(); } catch (e) { /* ignore */ }
  }

  function startPlayer(startAt) {
    const el0 = $('player-el');
    const failTimer = setTimeout(() => {
      if (!playerReady) {
        el0.className = 'fallback';
        el0.textContent = 'The video player did not load. The lines are all below.';
      }
    }, 10000);
    window.onYouTubeIframeAPIReady = function () {
      player = new window.YT.Player('player-el', {
        videoId: video.youtube_id,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, start: Math.floor(startAt || 0) },
        events: {
          onReady: () => { playerReady = true; clearTimeout(failTimer); if (mode === 'ear') hideCaptions(); },
        },
      });
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(failTimer); el0.className = 'fallback'; el0.textContent = 'The video player did not load. The lines are all below.'; };
    document.head.appendChild(s);
    setInterval(tick, 250);
  }

  // --- a typed line ----------------------------------------------------------

  function drawTyped() {
    const line = lines[0];
    const box = $('typed');
    box.hidden = false;
    box.className = 'panel stack typed';
    box.textContent = '';
    box.append(
      el('div', { class: 'label', text: 'as written' }),
      el('div', { class: 'written', style: 'font-size:18px;color:var(--text)', text: line.written }),
      el('div', { class: 'label', text: 'as you’ll hear it' }),
      line.status === 'worked' ? saidNode(line, shaky) : el('div', { class: 'note', text: line.status === 'pending' ? 'Still working it out…' : 'Not yet worked out.' }),
      why(line),
      controls(line),
    );
  }

  // --- pasted lines -----------------------------------------------------------

  // How many lines each screenshot gave, as the server answered when they were
  // sent (kept in this tab only; opened later, the page says less).
  function picturesNote() {
    let read = null;
    try { read = JSON.parse(sessionStorage.getItem('french-ear.read.' + video.id) || 'null'); } catch (e) { /* none */ }
    if (!read || !read.pictures) return '';
    const bits = read.pictures.map((p, i) => {
      const name = 'Screenshot ' + (i + 1) + ': ';
      if (!p.transcript) return name + 'no transcript found in it.';
      const n = p.read + (p.read === 1 ? ' line' : ' lines');
      const again = p.read - p.fresh;
      return name + n + (again ? ' (' + again + ' already in an earlier screenshot)' : '') + '.';
    });
    const dropped = read.pictures.reduce((n, p) => n + p.dropped, 0);
    if (dropped) bits.push(dropped + (dropped === 1 ? ' line' : ' lines') + ' I couldn’t read whole left out (usually cut off at the top or bottom).');
    return bits.join(' ');
  }

  function drawReadback() {
    $('readback').hidden = false;
    const fromPictures = video.caption_track === 'screenshots';
    $('readback-head').textContent = fromPictures ? 'Here’s how I read your screenshots' : 'Here’s how I read your paste';
    const note = fromPictures ? picturesNote() : '';
    $('readback-pictures').hidden = !note;
    $('readback-pictures').textContent = note;
    const list = $('readback-lines');
    list.textContent = '';
    for (const line of lines.slice(0, 3)) {
      list.appendChild(el('li', null, [
        timed ? el('span', { class: 'time', text: clock(line.start_s) }) : null,
        el('span', { text: line.written }),
      ]));
    }
    $('readback-note').textContent = lines.length + (lines.length === 1 ? ' line' : ' lines') + ' in all. '
      + (timed ? 'If these three don’t match how the video starts, the ' + (fromPictures ? 'screenshots were' : 'paste was') + ' read wrong.'
        : 'No timings in this transcript — lines won’t follow the video.');
  }

  // A "Add screenshots of the transcript" form: the pictures and this video's
  // link go up; the page opens on the video's lines. `pre` names the form
  // ('' on the no-lines page, 're-' under "Add the transcript again").
  function picturesForm(pre, youtubeId, busy) {
    const form = $(pre + 'pics-form');
    const input = $(pre + 'pictures');
    const go = $(pre + 'pics-go');
    const msg = $(pre + 'pics-msg');
    picturePicker(input, $(pre + 'picked'), (n) => { $(pre + 'pics-controls').hidden = !n; msg.textContent = ''; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      go.disabled = true;
      if (busy) busy(true);
      go.textContent = 'Reading your screenshots… this can take a minute';
      try {
        const v = await sendPictures(youtubeId, [...input.files]);
        location.replace('/watch?id=' + v.id);
      } catch (err) {
        msg.textContent = err.message;
        go.disabled = false;
        if (busy) busy(false);
        go.textContent = 'Use these screenshots';
      }
    });
  }

  // "Add the transcript again": a new paste or new screenshots replace the
  // video's lines, and the page opens again on them.
  function drawRepaste() {
    $('repaste').hidden = false;
    picturesForm('re-', video.youtube_id);
    const form = $('repaste-form');
    const go = $('repaste-go');
    const msg = $('repaste-msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      go.disabled = true;
      go.textContent = 'Reading your transcript…';
      try {
        const v = await api('POST', '/api/videos', { link: video.youtube_id, transcript: $('repaste-text').value });
        location.replace('/watch?id=' + v.id);
      } catch (err) {
        msg.textContent = err.message;
        go.disabled = false;
        go.textContent = 'Use this transcript';
      }
    });
  }

  // A video YouTube wouldn't give the captions for. Nothing is saved until
  // lines exist: the transcript pasted here, or YouTube answering this time.
  async function loadNoLines() {
    let info;
    try { info = await api('GET', '/api/youtube/' + ytId); } catch (err) { $('load-msg').textContent = err.message; return; }
    if (info.video_id) { location.replace('/watch?id=' + info.video_id); return; }
    video = { youtube_id: ytId };
    timed = false;
    $('watch').hidden = false;
    $('title').textContent = 'YouTube video ' + ytId;
    $('sub').textContent = 'https://www.youtube.com/watch?v=' + ytId;
    for (const id of ['modes', 'ear', 'lines', 'side']) $(id).hidden = true;
    $('watch').style.gridTemplateColumns = '1fr';
    $('nolines').hidden = false;
    $('nolines-why').textContent = info.failure
      ? 'What YouTube did: ' + info.failure.error
      : 'YouTube refused the captions earlier; the details were not kept.';

    const form = $('paste-form');
    const go = $('paste-go');
    const again = $('yt-again');
    const msg = $('paste-msg');
    picturesForm('', ytId, (on) => { go.disabled = on; again.disabled = on; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      go.disabled = true; again.disabled = true;
      go.textContent = 'Reading your transcript…';
      try {
        const v = await api('POST', '/api/videos', { link: ytId, transcript: $('paste').value });
        location.href = '/watch?id=' + v.id;
      } catch (err) {
        msg.textContent = err.message;
        go.disabled = false; again.disabled = false;
        go.textContent = 'Use this transcript';
      }
    });
    again.addEventListener('click', async () => {
      msg.textContent = '';
      go.disabled = true; again.disabled = true;
      again.textContent = 'Asking YouTube…';
      try {
        const v = await api('POST', '/api/youtube/' + ytId + '/retry');
        location.href = '/watch?id=' + v.id;
      } catch (err) {
        $('nolines-why').textContent = 'Tried again just now. What YouTube did: ' + err.message;
        go.disabled = false; again.disabled = false;
        again.textContent = 'Try YouTube again';
      }
    });
    startPlayer(0);
  }

  // --- start -----------------------------------------------------------------

  async function load() {
    if (!videoId && ytId) return loadNoLines();
    if (!videoId) { $('load-msg').textContent = 'No video named in the address.'; return; }
    let pats, list;
    try {
      [video, pats, list] = await Promise.all([
        api('GET', '/api/videos/' + videoId),
        api('GET', '/api/patterns'),
        api('GET', '/api/pattern-list'),
      ]);
    } catch (err) { $('load-msg').textContent = err.message; return; }
    for (const p of list.items) byId[p.id] = p;
    shaky = shakySet(pats);
    lines = video.lines;
    $('watch').hidden = false;
    $('title').textContent = video.title;
    document.title = 'French ear — ' + video.title;

    if (!video.youtube_id) {
      for (const id of ['modes', 'player-wrap', 'ear', 'lines', 'side']) $(id).hidden = true;
      $('watch').classList.add('typed-only');
      $('watch').style.gridTemplateColumns = '1fr';
      $('sub').textContent = 'A line you typed or pasted.';
      drawTyped();
      if (video.counts.pending) {
        const again = setInterval(async () => {
          video = await api('GET', '/api/videos/' + video.id);
          lines = video.lines;
          drawTyped();
          if (!video.counts.pending) clearInterval(again);
        }, 3000);
      }
      return;
    }

    const pasted = video.caption_track === 'pasted' || video.caption_track === 'screenshots';
    timed = lines.some((l) => l.start_s != null);
    $('sub').textContent = video.counts.total + ' lines · ' + (video.caption_track === 'screenshots' ? 'from your screenshots of the transcript'
      : pasted ? 'from a transcript you pasted' : 'captions: ' + (video.caption_track || 'unknown'));
    drawLines();
    drawStatus();
    drawEpisode();
    if (pasted) drawReadback();
    drawRepaste();
    document.body.dataset.mode = '';
    if (timed) setMode(mode);
    else {
      // Nothing to follow the clock with: a plain list, Follow along only,
      // and the remembered mode left as it was.
      mode = 'follow';
      document.body.dataset.mode = 'follow';
      $('modes').hidden = true;
      $('ear').hidden = true;
    }
    for (const b of document.querySelectorAll('#modes button')) b.addEventListener('click', () => setMode(b.dataset.mode));
    $('wwt').addEventListener('click', whatWasThat);
    for (const ev of ['wheel', 'touchmove', 'keydown']) window.addEventListener(ev, () => { lastUserScroll = Date.now(); }, { passive: true });
    window.addEventListener('pagehide', flushOnLeave);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnLeave(); });
    if (video.counts.pending || video.working) poll();

    const lineParam = q.get('line');
    let startAt = Number(q.get('t')) || 0;
    if (lineParam != null && lines[Number(lineParam)]) {
      const line = lines[Number(lineParam)];
      startAt = line.start_s || 0;
      if (mode === 'ear') setMode('follow');
      const li = nodes.get(line.idx);
      looked.add(line.idx); // opened from the kept list: not a new look
      li.querySelector('.line-main').click();
      setTimeout(() => li.scrollIntoView({ block: 'center' }), 50);
      lastUserScroll = Date.now();
    }
    startPlayer(startAt);
  }

  load();
})();
