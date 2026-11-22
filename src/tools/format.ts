/** How the summaries say things, the same in every tool. */

export const firstLine = (message: string) => message.split('\n')[0] ?? '';

/** A commit's time: the store stamps seconds. */
export const when = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Named = { label?: unknown; id?: unknown; '@id'?: unknown };

/** A record's or a summary's label, else its id. */
export function label(record: unknown): string {
  const r = (record ?? {}) as Named;
  return String(r.label ?? r.id ?? r['@id'] ?? '(unnamed)');
}

/** A summary as a line: "label (Type/id; Apply; Approved)". */
export function named(record: unknown): string {
  if (typeof record === 'string') return record;
  const r = (record ?? {}) as Record<string, unknown>;
  const id = String(r.id ?? r['@id'] ?? '');
  const facts = [id, r.bloomsLevel, r.status, r.state].filter((f) => f !== undefined && f !== '');
  return r.label ? `${String(r.label)} (${facts.join('; ')})` : facts.join('; ');
}

/** A short form of free text, so a summary line stays one line. */
export function clip(text: unknown, max = 100): string {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
