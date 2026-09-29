import { createHash } from 'node:crypto';

export const EMBEDDING_MODEL = process.env.NVIDIA_EMBEDDING_MODEL || 'nvidia/nemotron-3-embed-1b';
const queryCache = new Map<string, number[]>();

/** NVIDIA has distinct modes for indexing passages and embedding questions. */
export async function embedTexts(texts: string[], inputType: 'passage' | 'query', apiKey = process.env.NVIDIA_API_KEY || ''): Promise<number[][]> {
  if (!apiKey || !texts.length) return [];
  const cacheKey = createHash('sha256').update(`${EMBEDDING_MODEL}:${apiKey}:${texts[0]}`).digest('hex');
  if (inputType === 'query' && texts.length === 1 && queryCache.has(cacheKey)) return [queryCache.get(cacheKey)!];
  const response = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, input_type: inputType, encoding_format: 'float', truncate: 'END' }),
  });
  if (!response.ok) throw new Error(`NVIDIA embedding service returned ${response.status}`);
  const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
  const vectors = body.data?.sort((a, b) => a.index - b.index).map((item) => item.embedding) || [];
  if (vectors.length !== texts.length || vectors.some((v) => !v.length || v.some((x) => !Number.isFinite(x)))) throw new Error('Invalid embedding response');
  if (inputType === 'query' && texts.length === 1) {
    if (queryCache.size >= 100) queryCache.delete(queryCache.keys().next().value!);
    queryCache.set(cacheKey, vectors[0]);
  }
  return vectors;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let product = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { product += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? product / Math.sqrt(aa * bb) : 0;
}

export function retrievalQuery(question: string, previousQuestions: string[]): string {
  const followUp = /\b(it|its|they|their|those|that|them|this)\b/i.test(question) || /^(why|more detail|expand|shorter|in brief)[?.!\s]*$/i.test(question.trim());
  return followUp && previousQuestions.length ? `${previousQuestions.at(-1)}\nFollow-up: ${question}` : question;
}
