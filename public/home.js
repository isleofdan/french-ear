'use strict';
(function () {
  const { api, sendPictures, picturePicker, el, topBar, sendPhoto, momentItem, shakySet } = window.FE;
  document.getElementById('top').replaceWith(topBar('/'));

  const linkForm = document.getElementById('link-form');
  const link = document.getElementById('link');
  const linkMsg = document.getElementById('link-msg');
  const linkGo = document.getElementById('link-go');
  const transcript = document.getElementById('transcript');

  const pictures = document.getElementById('pictures');
  const picked = document.getElementById('picked');

  // A link shared from another app (Android's Share -> French ear) lands in
  // the link box; shared screenshots are held on the server and counted here.
  const params = new URLSearchParams(location.search);
  const shared = params.get('shared');
  let sharedToken = params.get('pictures');
  let sharedCount = 0;
  const m = shared ? shared.match(/https?:\/\/\S+/) : null;
  if (m) link.value = m[0];
  else if (shared && !sharedToken) link.value = shared;
  if (params.get('share_error')) linkMsg.textContent = params.get('share_error');
  history.replaceState(null, '', sharedToken ? '/?pictures=' + sharedToken : '/');
  const sayPicked = picturePicker(pictures, picked, null, () => sharedCount);
  if (sharedToken) {
    api('GET', '/api/shared/' + sharedToken).then((r) => {
      sharedCount = r.count;
      if (!sharedCount) {
        sharedToken = null;
        history.replaceState(null, '', '/');
        linkMsg.textContent = 'The shared screenshots are no longer here (they are kept for an hour). Add them again.';
        return;
      }
      sayPicked();
      if (!link.value) linkMsg.textContent = "Paste the video's link too.";
      link.focus();
    }).catch((err) => { linkMsg.textContent = err.message; });
  }

  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    linkMsg.textContent = '';
    linkGo.disabled = true;
    const pasted = transcript.value.trim();
    const withPictures = pictures.files.length > 0 || sharedCount > 0;
    if (withPictures && pasted) {
      linkMsg.textContent = 'Use either the screenshots or the pasted transcript, not both. Clear the transcript box to use the screenshots.';
      linkGo.disabled = false;
      return;
    }
    linkGo.textContent = withPictures ? 'Reading your screenshots… this can take a minute' : pasted ? 'Reading your transcript…' : 'Reading the captions…';
    try {
      const v = withPictures
        ? await sendPictures(link.value, [...pictures.files], sharedCount ? sharedToken : null)
        : await api('POST', '/api/videos', pasted ? { link: link.value, transcript: pasted } : { link: link.value });
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

  // "Add a photo from the TV": one photo, sent at once; the after-photo page
  // takes his notes while the subtitle is read.
  const photo = document.getElementById('photo');
  const photoText = document.getElementById('photo-text');
  const photoMsg = document.getElementById('photo-msg');
  photo.addEventListener('change', async () => {
    if (!photo.files.length) return;
    photoMsg.textContent = '';
    photoText.textContent = 'Sending the photo…';
    try {
      const m = await sendPhoto(photo.files[0]);
      location.href = '/moment?id=' + m.id + '&new=1';
    } catch (err) {
      photoMsg.textContent = err.message;
      photoText.textContent = 'Add a photo from the TV';
      photo.value = '';
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

  Promise.all([api('GET', '/api/home'), api('GET', '/api/patterns')]).then(([home, pats]) => {
    if (home.moments && home.moments.length) {
      const shaky = shakySet(pats);
      const box = document.getElementById('moments');
      for (const m of home.moments) box.appendChild(momentItem(m, shaky));
      document.getElementById('tv-section').hidden = false;
    }
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
