/** Tools use fixed network destinations and bounded inputs; no code evaluation. */
export function calculate(expression: string): number {
  if (!expression.trim() || expression.length > 200 || /[^\d.\s()+*/%\-]/.test(expression)) {
    throw new Error('Use numbers, parentheses, and + - * / % only (maximum 200 characters).');
  }
  const tokens = expression.match(/\d*\.?\d+|[()+*/%\-]/g) || [];
  // Reject malformed decimals instead of interpreting two adjacent tokens.
  if (tokens.join('') !== expression.replace(/\s/g, '')) throw new Error('Invalid numeric expression.');
  let position = 0;
  const primary = (): number => {
    const token = tokens[position++];
    if (token === '-' || token === '+') return (token === '-' ? -1 : 1) * primary();
    if (token === '(') {
      const value = sum();
      if (tokens[position++] !== ')') throw new Error('Missing closing parenthesis.');
      return value;
    }
    if (token === undefined || !/^(\d*\.?\d+)$/.test(token)) throw new Error('Expected a number.');
    return Number(token);
  };
  const product = (): number => {
    let value = primary();
    while (['*', '/', '%'].includes(tokens[position])) {
      const operator = tokens[position++];
      const right = primary();
      value = operator === '*' ? value * right : operator === '/' ? value / right : value % right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (['+', '-'].includes(tokens[position])) {
      const operator = tokens[position++];
      const right = product();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };
  const value = sum();
  if (position !== tokens.length || !Number.isFinite(value)) throw new Error('Invalid expression or division by zero.');
  return value;
}

export type WebSource = { title: string; url: string; text: string };

/** Public encyclopedia search works with the NVIDIA key alone. */
export async function searchWeb(query: string, signal?: AbortSignal): Promise<WebSource[]> {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.search = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: query,
    gsrlimit: '4', prop: 'extracts|info', exintro: '1', explaintext: '1', exchars: '1800',
    inprop: 'url', format: 'json' }).toString();
  const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]),
    headers: { 'User-Agent': 'NexusAI/2.0 (local research workspace)' } });
  if (!response.ok) throw new Error(`Public web search is unavailable (${response.status}).`);
  const payload = await response.json();
  return Object.values(payload.query?.pages || {}).map((page: any) => ({
    title: String(page.title || ''), url: String(page.fullurl || ''), text: String(page.extract || '').slice(0, 1800),
  })).filter((source) => source.text && source.url.startsWith('https://en.wikipedia.org/'));
}
