export function normalizePeopleCodeSource(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
}

export function sourcesMatch(
  expected: string,
  actual: string
): boolean {
  return (
    normalizePeopleCodeSource(expected) ===
    normalizePeopleCodeSource(actual)
  );
}