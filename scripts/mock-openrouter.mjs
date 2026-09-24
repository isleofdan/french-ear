// A stand-in for OpenRouter for local checks. Answers the "as said" call the
// way a model would, from scripts/fixtures.mjs; lines it does not know come
// back unchanged. Markers in a line force the failures the checks need:
//   IDINVENTE  -> that line's span names a pattern that is not in the list
//   HORSLIMITE -> that line's span runs past the end of the line
//   COUPE      -> the whole answer is cut off after the first two lines
//   PANNE      -> the first model answers 500 (the fallback must answer)
// GET /calls answers { calls, models } so a check can see who was asked.
//   node scripts/mock-openrouter.mjs [port] [first-model-id]
import http from 'node:http';
import { answerFor } from './fixtures.mjs';

const port = Number(process.argv[2]) || 8802;
const firstModel = process.argv[3] || 'anthropic/claude-sonnet-4.6';
const models = [];

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
