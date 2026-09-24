// A stand-in for YouTube for local checks: the watch page, the Innertube
// player call and the caption text, for a few made-up video ids.
//   node scripts/mock-youtube.mjs [port]
//
//   frManual001  French track by hand + French auto + English -> the hand-made one
//   frAutoOnly1  French auto-generated only
//   enOnly00001  English only -> "no French captions"
//   noCaption01  no captions at all
//   botBlocked1  the watch page asks to prove it is not a bot; no player
//   emptyText01  a French track whose text answers empty
//   emptyText02  three tracks (English auto, French auto, French); the text answers 429
//   refusedVid2  the same as emptyText02 (a second one, for the screenshots)
//   json3Only01  a French track whose text answers only as json3
import http from 'node:http';
import { VIDEO_LINES } from './fixtures.mjs';

const port = Number(process.argv[2]) || 8801;
const base = `http://127.0.0.1:${port}`;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&amp;#39;');

const track = (id, lang, kind, name) => ({
  baseUrl: `${base}/api/timedtext?v=${id}&lang=${lang}${kind ? '&kind=' + kind : ''}&fmt=srv3`,
  name: { simpleText: name }, languageCode: lang, ...(kind ? { kind } : {}),
});

const VIDEOS = {
  frManual001: { title: 'Easy French: dans la rue (mock)', tracks: (id) => [track(id, 'en', 'asr', 'English (auto-generated)'), track(id, 'fr', 'asr', 'French (auto-generated)'), track(id, 'fr', null, 'French')] },
  frAutoOnly1: { title: 'Vlog du dimanche (mock)', tracks: (id) => [track(id, 'fr', 'asr', 'French (auto-generated)')] },
  enOnly00001: { title: 'An English talk (mock)', tracks: (id) => [track(id, 'en', null, 'English')] },
  noCaption01: { title: 'No captions (mock)', tracks: () => [] },
  emptyText01: { title: 'Empty track (mock)', tracks: (id) => [track(id, 'fr', null, 'French')] },
  emptyText02: { title: 'Refused track (mock)', tracks: (id) => [track(id, 'en', 'asr', 'English (auto-generated)'), track(id, 'fr', 'asr', 'French (auto-generated)'), track(id, 'fr', null, 'French')] },
  refusedVid2: { title: 'Refused track, again (mock)', tracks: (id) => [track(id, 'en', 'asr', 'English (auto-generated)'), track(id, 'fr', 'asr', 'French (auto-generated)'), track(id, 'fr', null, 'French')] },
  json3Only01: { title: 'json3 only (mock)', tracks: (id) => [track(id, 'fr', null, 'French')] },
};

function player(id) {
  const v = VIDEOS[id];
  if (!v) return { playabilityStatus: { status: 'ERROR', reason: 'Video unavailable' } };
  const tracks = v.tracks(id);
  return {
    playabilityStatus: { status: 'OK' },
    videoDetails: { videoId: id, title: v.title, lengthSeconds: String(VIDEO_LINES.length * 4) },
    ...(tracks.length ? { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } } : {}),
  };
}

const lines = (auto) => VIDEO_LINES.map((w, i) => ({ start: i * 3.5 + 0.5, dur: auto ? 4.2 : 3.2, w }));

http.createServer((req, res) => {
  const u = new URL(req.url, base);
  const send = (status, type, body) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
  if (u.pathname === '/watch') {
    const id = u.searchParams.get('v');
    if (id === 'botBlocked1') return send(200, 'text/html', '<html><body>Sign in to confirm you’re not a bot</body></html>');
    const pr = JSON.stringify(player(id));
    return send(200, 'text/html', `<html><script>ytcfg.set({"INNERTUBE_API_KEY":"mock-key"});var ytInitialPlayerResponse = ${pr};var meta = {};</script></html>`);
  }
  if (u.pathname === '/youtubei/v1/player' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const { videoId } = JSON.parse(body || '{}');
      if (videoId === 'botBlocked1') return send(200, 'application/json', JSON.stringify({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } }));
      return send(200, 'application/json', JSON.stringify(player(videoId)));
    });
    return;
  }
  if (u.pathname === '/api/timedtext') {
    const id = u.searchParams.get('v');
    const auto = u.searchParams.get('kind') === 'asr';
    const fmt = u.searchParams.get('fmt');
    if (id === 'emptyText01') return send(200, 'text/xml', '');
    if (id === 'emptyText02' || id === 'refusedVid2') return send(429, 'text/html', '<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"/></head><body>Too many requests</body></html>');
    if (id === 'json3Only01' && fmt !== 'json3') return send(200, 'text/xml', '');
    if (fmt === 'json3') {
      const events = lines(auto).map((l) => ({ tStartMs: Math.round(l.start * 1000), dDurationMs: Math.round(l.dur * 1000), segs: [{ utf8: l.w }] }));
      return send(200, 'application/json', JSON.stringify({ events }));
    }
    const xml = `<?xml version="1.0" encoding="utf-8" ?><transcript>${lines(auto).map((l) => `<text start="${l.start}" dur="${l.dur}">${esc(l.w)}</text>`).join('')}</transcript>`;
    return send(200, 'text/xml', xml);
  }
  if (u.pathname === '/oembed') return send(404, 'text/plain', 'Not Found');
  send(404, 'text/plain', 'no such mock');
}).listen(port, () => console.log(`mock youtube on ${port}`));
