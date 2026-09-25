'use strict';
// One photo from the TV.
//   Not saved yet (straight after the photo): the after-photo screen. The
//   photo small at the top, the subtitle as read (he can correct it), "What it
//   sounded like", "What's happening", and "Save for later". Nothing else: he
//   is watching, and this takes fifteen seconds.
//   Saved: the photo bigger, the line as written and as you'll hear it with
//   its patterns named, how sure it is and why, his notes, Keep, "Try again"
//   when it could not be worked out, and a way to change the notes and work
//   it out again.
// While the photo is being read or worked out, the page looks again every few
// seconds (only while it is open).
(function () {
  const { api, el, topBar, saidNode, shakySet, whyList, sureWord, momentState, sendPhoto } = window.FE;
  document.getElementById('top').replaceWith(topBar('/tv'));
  const box = document.getElementById('content');
  const q = new URLSearchParams(location.search);
  const id = Number(q.get('id'));
  const loadMsg = document.getElementById('load-msg');

  let byId = {};
  let shaky = new Set();
  let timer = null;
  let form = null; // the notes form, while it is on screen

  const photo = (cls) => el('img', { class: cls, src: '/api/moments/' + id + '/photo', alt: 'Your photo from the TV' });
  const LANG = { en: 'English subtitle', fr: 'French subtitle' };

  // The notes form: the subtitle, what it sounded like, what's happening.
  // Used after the photo ("Save for later") and later to change the notes.
  function notesForm(m, button) {
    const sub = el('textarea', { id: 'subtitle', rows: '2', placeholder: '' });
    const heard = el('input', { id: 'heard', type: 'text', autocomplete: 'off', placeholder: 'shay pa, ya kelk shoz…' });
    const scene = el('input', { id: 'scene', type: 'text', autocomplete: 'off', placeholder: 'Who is talking, about what' });
    heard.value = m.heard_note || '';
    scene.value = m.scene_note || '';
    let typed = false;
    sub.addEventListener('input', () => { typed = true; });
    const fillSubtitle = (x) => {
      if (typed) return;
      sub.value = x.subtitle || '';
      sub.placeholder = x.read_status === 'reading' ? 'Reading the subtitle…'
        : x.read_status === 'failed' ? 'Couldn’t read the photo. Type the subtitle if you can see it.'
          : 'No subtitle in this photo. Type it if you can see one.';
    };
    fillSubtitle(m);
    const msg = el('div', { class: 'msg', role: 'alert' });
    const go = el('button', { type: 'submit', class: 'primary', text: button });
    const f = el('form', { class: 'stack after-photo' }, [
      el('label', { for: 'subtitle', text: 'The subtitle' }), sub,
      el('label', { for: 'heard', text: 'What it sounded like' }), heard,
      el('label', { for: 'scene', text: 'What’s happening' }), scene,
      msg, go,
    ]);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      go.disabled = true;
      msg.textContent = '';
      const body = { heard_note: heard.value, scene_note: scene.value };
      // Sent only when he typed in it: a subtitle not yet read is left for
      // the reading to fill.
      if (typed) body.subtitle = sub.value;
      try {
        const saved = await api('POST', '/api/moments/' + id, body);
        form = null;
        draw(saved, { justSaved: true });
      } catch (err) { msg.textContent = err.message; go.disabled = false; }
    });
    return { node: f, fillSubtitle };
  }

  function anotherPhoto() {
    const text = el('span', { text: 'Another photo' });
    const input = el('input', { type: 'file', accept: 'image/*' });
    const msg = el('div', { class: 'msg', role: 'alert' });
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      text.textContent = 'Sending the photo…';
      try {
        const m = await sendPhoto(input.files[0]);
        location.href = '/moment?id=' + m.id + '&new=1';
      } catch (err) { msg.textContent = err.message; text.textContent = 'Another photo'; input.value = ''; }
    });
    return el('div', { class: 'stack', style: 'gap:6px' }, [el('label', { class: 'pick pick-plain' }, [input, text]), msg]);
  }

  function keepButton(line) {
    const b = el('button', { type: 'button', class: 'secondary small', 'aria-pressed': line.kept ? 'true' : 'false', text: line.kept ? 'Kept' : 'Keep' });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = line.kept ? await api('DELETE', '/api/lines/' + line.id + '/keep') : await api('POST', '/api/lines/' + line.id + '/keep');
        line.kept = r.kept;
        b.setAttribute('aria-pressed', line.kept ? 'true' : 'false');
        b.textContent = line.kept ? 'Kept' : 'Keep';
      } catch (err) { alert(err.message); }
      b.disabled = false;
    });
    return b;
  }

  function tryAgain() {
    const b = el('button', { type: 'button', class: 'primary', text: 'Try again' });
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { draw(await api('POST', '/api/moments/' + id + '/retry')); } catch (err) { alert(err.message); b.disabled = false; }
    });
    return b;
  }

  function note(label, text) {
    return el('div', { class: 'stack', style: 'gap:2px' }, [
      el('div', { class: 'label', text: label }),
      el('div', { class: text ? 'note-text' : 'note', text: text || 'Nothing noted.' }),
    ]);
  }

  // The after-photo screen.
  function drawNew(m) {
    if (form) {
      form.fillSubtitle(m);
      const head = box.querySelector('.photo-head .note');
      if (head && m.read_status !== 'reading') head.textContent = 'Read from your photo. Wrong? Fix the text.';
      return;
    }
    box.className = 'narrow stack';
    box.textContent = '';
    form = notesForm(m, 'Save for later');
    box.append(
      el('div', { class: 'photo-head' }, [
        photo('moment-thumb'),
        el('div', { class: 'note', text: m.read_status === 'reading' ? 'Reading the subtitle from your photo…' : 'Read from your photo. Wrong? Fix the text.' }),
      ]),
      form.node,
    );
  }

  function drawSaved(m, { justSaved = false } = {}) {
    box.className = 'narrow stack';
    const keepOpen = box.querySelector('details.change') && box.querySelector('details.change').open;
    if (keepOpen) return; // he is changing the notes: leave the page as it is
    box.textContent = '';
    if (justSaved) {
      box.append(el('div', { class: 'panel stack saved-note' }, [
        el('p', { style: 'margin:0;font-weight:600', text: 'Saved for later.' }),
        el('p', { class: 'note', style: 'margin:0', text: 'The French is worked out while you watch. It will be under From the TV.' }),
        anotherPhoto(),
      ]));
    }
    box.append(photo('moment-photo'));

    const state = momentState(m);
    if (state) {
      const bits = [el('p', { class: 'note', style: 'margin:0', text: state })];
      if (m.work_status === 'unworked' || (m.read_status === 'failed' && !m.busy)) bits.push(tryAgain());
      box.append(el('div', { class: 'stack status-box' }, bits));
    }

    box.append(el('div', { class: 'stack', style: 'gap:4px' }, [
      el('div', { class: 'label', text: m.subtitle_lang ? LANG[m.subtitle_lang] : 'The subtitle' }),
      el('div', { class: m.subtitle ? 'subtitle-text' : 'note', text: m.subtitle || (m.read_status === 'reading' ? 'Reading…' : 'No subtitle in this photo.') }),
    ]));

    const line = m.line;
    if (line && m.work_status === 'worked' && line.status === 'worked') {
      box.append(
        el('div', { class: 'stack', style: 'gap:4px' }, [
          el('div', { class: 'label', text: 'as written' }),
          el('div', { class: 'written', style: 'font-size:18px;color:var(--text)', text: line.written }),
        ]),
        el('div', { class: 'stack', style: 'gap:4px' }, [
          el('div', { class: 'label', text: 'as you’ll hear it' }),
          saidNode(line, shaky, 'said said-big'),
          el('div', { class: 'note' }, [el('b', { text: sureWord(m) }), m.why ? ' — ' + m.why : '']),
        ]),
        el('div', { class: 'panel stack' }, [
          line.spans.length ? whyList(line, byId, shaky) : el('p', { class: 'note', style: 'margin:0', text: 'Said as written — nothing here changes in speech.' }),
          el('div', { class: 'controls' }, [keepButton(line)]),
        ]),
      );
    }

    box.append(note('What it sounded like', m.heard_note), note('What’s happening', m.scene_note));

    const change = notesForm(m, 'Save and work it out again');
    box.append(el('details', { class: 'change repaste' }, [el('summary', { text: 'Change the notes' }), change.node]));
  }

  function draw(m, opts) {
    loadMsg.textContent = '';
    if (!m.saved) drawNew(m); else drawSaved(m, opts);
    clearTimeout(timer);
    if (m.busy || m.read_status === 'reading' || (m.saved && ['waiting', 'working'].includes(m.work_status))) {
      timer = setTimeout(() => api('GET', '/api/moments/' + id).then((x) => draw(x, { justSaved: Boolean(box.querySelector('.saved-note')) })).catch((err) => { loadMsg.textContent = err.message; }), 2500);
    }
  }

  Promise.all([api('GET', '/api/moments/' + id), api('GET', '/api/pattern-list'), api('GET', '/api/patterns')]).then(([m, list, pats]) => {
    for (const p of list.items) byId[p.id] = p;
    shaky = shakySet(pats);
    draw(m);
  }).catch((err) => { loadMsg.textContent = err.message; });
})();
