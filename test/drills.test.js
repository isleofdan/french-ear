'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../lib/db');

// Three videos: two YouTube videos with timed lines (one older, one newer)
// and one pasted without timings; plus a typed line and a photo from the TV,
// neither of which has a clip.
function fixture() {
  db.open(fs.mkdtempSync(path.join(os.tmpdir(), 'fe-drills-')));
  const work = (videoId, rows) => {
    const lines = db.getVideo(videoId).lines;
    rows.forEach((patterns, i) => db.setLineWorked(lines[i].id, { spoken: lines[i].written, spans: [], patterns }));
    return lines.map((l) => l.id);
  };
  const older = db.addVideo({ youtube_id: 'olderVideo1', title: 'Older', caption_track: 'fr', lines: [
    { start_s: 0, end_s: 3, written: 'Il y a un problème avec la voiture.' },
    { start_s: 3, end_s: 6, written: 'Je ne sais pas ce que tu veux dire.' },
    { start_s: 6, end_s: 9, written: 'Bonjour à tous.' },
  ] });
  const olderIds = work(older, [['il-y-a'], ['je-ch', 'ne-dropped'], []]);
  const untimed = db.addVideo({ youtube_id: 'untimedVid1', title: 'Untimed', caption_track: 'pasted', lines: [
    { written: 'Il y a du monde ce soir.' },
    { written: 'Tu as vu ça ?' },
  ] });
  work(untimed, [['il-y-a'], ['tu-t']]);
  const newer = db.addVideo({ youtube_id: 'newerVideo1', title: 'Newer', caption_track: 'fr', lines: [
    { start_s: 10, end_s: 14, written: 'Il y a personne ici.' },
    { start_s: 14, end_s: 17, written: 'Tu as faim ?' },
    { start_s: 17, end_s: 20, written: 'Il faut que je te parle.' },
  ] });
  const newerIds = work(newer, [['il-y-a'], ['tu-t'], ['il-dropped', 'e-dropped']]);
  // a typed line and a photo from the TV: lines with patterns, no clip
  const typed = db.addVideo({ youtube_id: null, title: 'typed', lines: [{ written: 'Il y a un chat.' }] });
  work(typed, [['il-y-a']]);
  const tv = db.addVideo({ youtube_id: null, title: 'tv', caption_track: 'tv', lines: [{ start_s: 1, end_s: 2, written: 'Il y a eu un bruit.' }] });
  work(tv, [['il-y-a']]);
  return { olderIds, newerIds };
}

test('clips per pattern: timed lines of his YouTube videos only, newest video first', () => {
  const { olderIds, newerIds } = fixture();
  const ilya = db.clips('il-y-a');
  assert.deepEqual(ilya.map((c) => c.id), [newerIds[0], olderIds[0]], 'the newer video first; untimed, typed and TV lines left out');
  assert.equal(ilya[0].video.title, 'Newer');
  assert.equal(ilya[0].video.youtube_id, 'newerVideo1');
  assert.equal(ilya[1].start_s, 0);
  assert.equal(ilya[1].end_s, 3);
  assert.deepEqual(db.clips('tu-t').map((c) => c.id), [newerIds[1]]);
  assert.deepEqual(db.clips('oui-non'), []);
});

test('clip counts for all twenty in one call; Mix counts each clip once', () => {
  fixture();
  assert.deepEqual(db.clipCounts(), { 'il-y-a': 2, 'je-ch': 1, 'ne-dropped': 1, 'tu-t': 1, 'il-dropped': 1, 'e-dropped': 1 });
  assert.equal(db.clips().length, 5, 'a line with no pattern ("Bonjour à tous.") is no clip');
});
