// Sample French lines shared by the mock servers, the tests and the
// screenshots. KNOWN: written -> [spoken, [[the changed words, pattern id], ...]].
export const KNOWN = {
  'Je ne sais pas ce que tu veux dire.': ["Chais pas c'que tu veux dire.", [['Chais pas', 'je-ch'], ['Chais pas', 'ne-dropped'], ["c'que", 'e-dropped']]],
  'Il y a un problème avec la voiture.': ['Y a un problème avec la voiture.', [['Y a', 'il-y-a']]],
  "Tu as vu ce qu'il a fait ?": ["T'as vu c'qu'il a fait ?", [["T'as", 'tu-t'], ["c'qu'il", 'e-dropped']]],
  'Il faut que je te parle.': ["Faut qu'j'te parle.", [['Faut', 'il-dropped'], ["qu'j'te", 'e-dropped']]],
  'Nous ne savons pas encore.': ['On sait pas encore.', [['On sait', 'on-for-nous'], ['sait pas', 'ne-dropped']]],
  'Ils sont déjà partis, je crois.': ["I sont déjà partis, j'crois.", [['I sont', 'il-i'], ["j'crois", 'e-dropped']]],
  'Est-ce que tu viens ce soir ?': ['Tu viens ce soir ?', [['Tu viens ce soir ?', 'question-tone']]],
  "Qu'est-ce que tu fais là ?": ['Kess tu fais là ?', [['Kess', 'qu-est-ce-que']]],
  'Elle est arrivée hier soir.': ['Ell-è-tarrivée hier soir.', [['Ell-è-tarrivée', 'run-together']]],
  'Cela ne va pas du tout.': ['Ça va pas du tout.', [['Ça va pas', 'ca-for-cela'], ['va pas', 'ne-dropped']]],
  "Oui, bien sûr, c'est ça.": ["Ouais, ben ouais, c'est ça.", [['Ouais, ben ouais', 'fillers']]],
  'Parce que je suis fatigué.': ['Pasque chuis fatigué.', [['Pasque', 'parce-que'], ['chuis', 'je-ch']]],
  'Ne t\'inquiète pas pour ça.': ["T'inquiète pour ça.", [["T'inquiète", 't-inquiete']]],
  'Voilà le problème.': ["V'là le problème.", [["V'là", 'vowel-swallowed']]],
  'Bonjour à tous.': ['Bonjour à tous.', []],
  '[Musique]': ['[Musique]', []],
};

// The caption lines of the mock videos, in order, 3.5 seconds each.
export const VIDEO_LINES = [
  'Bonjour à tous.',
  'Je ne sais pas ce que tu veux dire.',
  'Il y a un problème avec la voiture.',
  "Tu as vu ce qu'il a fait ?",
  'Il faut que je te parle.',
  '[Musique]',
  'Nous ne savons pas encore.',
  'Ils sont déjà partis, je crois.',
  'Est-ce que tu viens ce soir ?',
  "Qu'est-ce que tu fais là ?",
  'Elle est arrivée hier soir.',
  'Cela ne va pas du tout.',
  "Oui, bien sûr, c'est ça.",
  'Parce que je suis fatigué.',
  "Ne t'inquiète pas pour ça.",
  'Voilà le problème.',
];

// One answer line the way a model writes it: offsets counted from the text.
export function answerFor(i, written) {
  const k = KNOWN[written];
  if (!k) return { i, spoken: written, spans: [], patterns: [] };
  const [spoken, marks] = k;
  const spans = marks.map(([frag, pattern]) => {
    const start = spoken.indexOf(frag);
    return { start, end: start + frag.length, text: frag, pattern };
  });
  return { i, spoken, spans, patterns: [...new Set(marks.map((m) => m[1]))] };
}
