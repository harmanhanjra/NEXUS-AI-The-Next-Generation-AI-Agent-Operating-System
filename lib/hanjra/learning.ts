/** Small CPU-only models. Learned labels never grant tools or override explicit action rules. */
export type Example = { query: string; owner: string };
export type Prediction = { owner: string; confidence: number; coverage: number; samples: number; accepted: boolean };
export type MemoryNote = { id: string; title: string; content: string; archived: boolean; updatedAt: number };
const stopWords = new Set('a an the and or to of for is are in on my me please can you it this that with'.split(' '));
export function terms(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || []).filter(t => t.length > 1 && !stopWords.has(t)).slice(0, 600);
}
export function uniqueExamples(examples: Example[]): Example[] {
  const unique = new Map<string, Example>();
  for (const example of examples) { const key = terms(example.query).join(' '); if (key) unique.set(key, example); }
  return [...unique.values()].slice(-200);
}
export function predictOwner(query: string, source: Example[]): Prediction | null {
  const examples = uniqueExamples(source), vocabulary = new Set<string>();
  const classes = new Map<string, { documents: number; total: number; counts: Map<string, number> }>();
  for (const example of examples) {
    const entry = classes.get(example.owner) || { documents: 0, total: 0, counts: new Map<string, number>() };
    entry.documents++;
    for (const term of terms(example.query)) { vocabulary.add(term); entry.total++; entry.counts.set(term, (entry.counts.get(term) || 0) + 1); }
    classes.set(example.owner, entry);
  }
  const queryTerms = terms(query); if (!classes.size || !queryTerms.length || !vocabulary.size) return null;
  // Unknown words do not create evidence for a class. Abstain on out-of-domain requests.
  const known = queryTerms.filter(t => vocabulary.has(t)), coverage = known.length / queryTerms.length;
  const scores = [...classes].map(([owner, entry]) => ({ owner, samples: entry.documents,
    score: Math.log(entry.documents / examples.length) + known.reduce((sum, term) => sum + Math.log(((entry.counts.get(term) || 0) + 1) / (entry.total + vocabulary.size)), 0) }));
  scores.sort((a,b) => b.score - a.score);
  const best = scores[0], denominator = scores.reduce((sum, entry) => sum + Math.exp(entry.score - best.score), 0);
  const confidence = 1 / denominator;
  return { owner: best.owner, confidence, coverage, samples: examples.length,
    accepted: examples.length >= 8 && classes.size >= 2 && best.samples >= 3 && confidence >= .8 && coverage >= .4 };
}
export function evaluateRouter(source: Example[]) {
  const examples = uniqueExamples(source); let correct = 0, accepted = 0;
  // Each normalized query is excluded from its own training fold, including duplicates.
  for (let index = 0; index < examples.length; index++) {
    const prediction = predictOwner(examples[index].query, examples.filter((_, i) => i !== index));
    if (prediction?.accepted) { accepted++; if (prediction.owner === examples[index].owner) correct++; }
  }
  return { samples: examples.length, evaluated: examples.length, accepted, agreement: accepted ? correct / accepted : null,
    coverage: examples.length ? accepted / examples.length : 0, method: 'leave-one-query-out' as const };
}
export function searchMemory(query: string, notes: MemoryNote[], limit = 5): Array<MemoryNote & { score: number }> {
  const active = notes.filter(n => !n.archived), queries = [...new Set(terms(query))];
  if (!queries.length || !active.length) return [];
  const documents = active.map(note => ({ note, tokens: terms(`${note.title} ${note.title} ${note.content}`) }));
  const averageLength = documents.reduce((sum, d) => sum + d.tokens.length, 0) / documents.length || 1;
  const frequency = new Map(queries.map(term => [term, documents.filter(d => d.tokens.includes(term)).length]));
  return documents.map(({note,tokens}) => {
    let score = 0;
    for (const term of queries) { const tf = tokens.filter(t => t === term).length; if (!tf) continue;
      const df = frequency.get(term) || 0, idf = Math.log(1 + (documents.length - df + .5) / (df + .5));
      score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * tokens.length / averageLength));
    }
    return {...note,score};
  }).filter(n => n.score > 0).sort((a,b) => b.score - a.score).slice(0,Math.max(0,Math.min(limit,10)));
}
