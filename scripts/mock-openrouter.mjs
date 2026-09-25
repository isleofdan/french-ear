// A stand-in for OpenRouter for local checks. Answers the "as said" call the
// way a model would, from scripts/fixtures.mjs; lines it does not know come
// back unchanged. Markers in a line force the failures the checks need:
//   IDINVENTE  -> that line's span names a pattern that is not in the list
//   HORSLIMITE -> that line's span runs past the end of the line
//   COUPE      -> the whole answer is cut off after the first two lines
//   PANNE      -> the first model answers 500 (the fallback must answer)
// A call carrying a picture (reading transcript screenshots) is answered from
// test/fixtures/pictures/answers.json, the picture known by its bytes; a
// picture it does not know comes back as "no transcript". A fixture marked
// first_model_fails makes the first picture model answer 500; a picture whose
// bytes contain PANNE-TOTALE makes every model answer 500.
// GET /calls answers { calls, models } so a check can see who was asked.
//   node scripts/mock-openrouter.mjs [port] [first-model-id] [first-picture-model-id]
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerFor } from './fixtures.mjs';

const port = Number(process.argv[2]) || 8802;
const firstModel = process.argv[3] || 'anthropic/claude-sonnet-4.6';
const firstPictureModel = process.argv[4] || 'google/gemini-2.5-flash';
const models = [];

const picDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'pictures');
const picAnswers = JSON.parse(readFileSync(join(picDir, 'answers.json'), 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const byHash = new Map(readdirSync(picDir).filter((f) => picAnswers[f]).map((f) => [sha(readFileSync(join(picDir, f))), picAnswers[f]]));

// A picture call -> [status, body].
function pictureReply(r) {
  const part = r.messages[1].content.find((c) => c.type === 'image_url');
  const bytes = Buffer.from(part.image_url.url.replace(/^data:[^,]*,/, ''), 'base64');
  const known = byHash.get(sha(bytes));
  if (bytes.includes('PANNE-TOTALE') || (known?.first_model_fails && r.model === firstPictureModel)) {
    return [500, { error: { message: 'provider down (mock)' } }];
  }
  const answer = known ? known.answer : { transcript: false, lines: [] };
  return [200, { choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }], usage: { prompt_tokens: 1300, completion_tokens: 300, cost: 0.0012 } }];
}

http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/calls') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ calls: models.length, models }));
  }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const r = JSON.parse(body);
    models.push(r.model);
    if (Array.isArray(r.messages[1].content)) {
      const [status, out] = pictureReply(r);
      res.writeHead(status, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    const lines = JSON.parse(r.messages[1].content);
    const reply = (content, finish = 'stop') => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] }));
    };
    if (r.model === firstModel && lines.some((l) => l.text.includes('PANNE'))) {
      res.writeHead(500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'provider down (mock)' } }));
    }
    const out = lines.map(({ i, text }) => {
      const a = answerFor(i, text.replace(/ ?(IDINVENTE|HORSLIMITE|COUPE|PANNE)/g, ''));
      if (text.includes('IDINVENTE')) return { i, spoken: text, spans: [{ start: 0, end: 3, text: text.slice(0, 3), pattern: 'liaison-magique' }], patterns: ['liaison-magique'] };
      if (text.includes('HORSLIMITE')) return { i, spoken: a.spoken, spans: [{ start: 5, end: 999, pattern: 'ne-dropped' }], patterns: ['ne-dropped'] };
      return a;
    });
    const json = JSON.stringify({ lines: out }, null, 1);
    if (lines.some((l) => l.text.includes('COUPE'))) {
      const cut = json.indexOf('"i": 2');
      return reply(json.slice(0, cut + 20), 'length');
    }
    reply(json);
  });
}).listen(port, () => console.log(`mock openrouter on ${port}`));
