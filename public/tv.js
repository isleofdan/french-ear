'use strict';
// "From the TV": every photo from the TV, newest first, each with its small
// photo, the subtitle as read, the French as said and how sure it is. Tapping
// one opens it. While any is still being read or worked out, the page looks
// again every few seconds (only while it is open).
(function () {
  const { api, el, topBar, sendPhoto, momentItem, shakySet } = window.FE;
  document.getElementById('top').replaceWith(topBar('/tv'));
  const box = document.getElementById('content');
  box.className = 'narrow stack';

  const list = el('ul', { class: 'list' });
  const intro = el('p', { class: 'muted', style: 'margin:0' });
  const msg = el('div', { class: 'msg', role: 'alert' });
  const pickText = el('span', { text: 'Add a photo from the TV' });
  const input = el('input', { type: 'file', accept: 'image/*' });
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    msg.textContent = '';
    pickText.textContent = 'Sending the photo…';
    try {
      const m = await sendPhoto(input.files[0]);
      location.href = '/moment?id=' + m.id + '&new=1';
    } catch (err) {
      msg.textContent = err.message;
      pickText.textContent = 'Add a photo from the TV';
      input.value = '';
    }
  });
  box.append(
    el('h1', { class: 'title', text: 'From the TV' }),
    intro,
    el('label', { class: 'pick pick-plain' }, [input, pickText]),
    msg,
    list,
  );

  let timer = null;
  async function draw() {
    try {
      const [data, pats] = await Promise.all([api('GET', '/api/moments'), api('GET', '/api/patterns')]);
      const shaky = shakySet(pats);
      intro.textContent = data.items.length
        ? data.items.length + (data.items.length === 1 ? ' photo' : ' photos') + ' from the TV, newest first.'
        : 'No photos yet. When a line gets past you on TV, take a photo of the screen.';
      list.textContent = '';
      for (const m of data.items) list.appendChild(momentItem(m, shaky));
      clearTimeout(timer);
      if (data.items.some((m) => m.busy)) timer = setTimeout(draw, 3000);
    } catch (err) { document.getElementById('load-msg').textContent = err.message; }
  }
  draw();
})();
