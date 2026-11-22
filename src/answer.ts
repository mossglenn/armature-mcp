/**
 * What a tool returns (plan §5, question 9, decided 2026-11-21 (b)): a short
 * summary the server writes from the hub's answer, then the hub's JSON. The
 * numbers come from code and the model explains them; a client that reads
 * structured content gets the whole answer there.
 *
 * Every answer names its commit (the hub's ETag) and the revision that served
 * it, so the model can pass the commit to the next tool. An answer over the
 * size budget is cut to fit, its largest list first, and says what was left
 * out and how to ask for it.
 *
 * A hub refusal is a tool error, not a protocol error: the model reads the
 * hub's code and message, one sentence on what the code means, and what to try
 * next, and can explain the refusal or correct course.
 */
import { HubError, type HubResult } from '@armature/client';
import type { CallToolResult } from '@modelcontextprotocol/server';

/** The default budget for an answer's structured content, in characters (plan §5). */
export const DEFAULT_BUDGET = 40_000;

export interface Truncation {
  /** Where the list that was cut sits in the answer, as a dotted path. */
  path: string;
  shown: number;
  total: number;
}

export interface AnswerOptions {
  /** The characters the structured content may take. */
  budget: number;
  /** What to try when the answer had to be cut: which argument narrows it. */
  narrow?: string;
}

/** A hub result's data with the commit it was read at and the revision that served it. */
export function stamped(result: HubResult<unknown>, data: Record<string, unknown> = result.data as Record<string, unknown>): Record<string, unknown> {
  return { ...data, ...(result.commit ? { commit: result.commit } : {}), ...(result.version ? { revision: result.version } : {}) };
}

export function answer(summary: string, data: Record<string, unknown>, options: AnswerOptions): CallToolResult {
  const { data: fitted, truncated } = fit(data, options.budget);
  const lines = [summary];
  if (truncated.length) {
    for (const t of truncated) lines.push(`Cut to fit: ${t.shown} of ${t.total} entries of ${t.path} are shown.`);
    lines.push(options.narrow ? `To see the rest, ${options.narrow}.` : 'Ask a narrower question to see the rest.');
    fitted.truncated = truncated;
  }
  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      { type: 'text', text: JSON.stringify(fitted, null, 2) },
    ],
    structuredContent: fitted,
  };
}

const size = (value: unknown) => JSON.stringify(value).length;

/** The arrays in an answer, two levels deep, with their paths. */
function arrays(data: Record<string, unknown>): Array<{ path: string[]; value: unknown[] }> {
  const found: Array<{ path: string[]; value: unknown[] }> = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) found.push({ path: [key], value });
    else if (value && typeof value === 'object') {
      for (const [inner, v] of Object.entries(value)) if (Array.isArray(v)) found.push({ path: [key, inner], value: v });
    }
  }
  return found;
}

function setAt(data: Record<string, unknown>, path: string[], value: unknown[]): void {
  if (path.length === 1) data[path[0]!] = value;
  else data[path[0]!] = { ...(data[path[0]!] as Record<string, unknown>), [path[1]!]: value };
}

/** Room kept for the `truncated` note the answer adds when it cuts. */
const NOTE_ROOM = 200;

/**
 * Cuts an answer to the budget: the largest list is shortened to as many
 * entries as fit, then the next largest if that was not enough. Entries are
 * kept from the start, since every read the server makes puts the most useful
 * first (teaching order, newest first, the record itself first).
 */
export function fit(data: Record<string, unknown>, budget: number): { data: Record<string, unknown>; truncated: Truncation[] } {
  const out = { ...data };
  const truncated: Truncation[] = [];
  const cut = new Set<string>();
  while (size(out) > budget) {
    const candidates = arrays(out).filter((a) => !cut.has(a.path.join('.')) && a.value.length > 0);
    if (!candidates.length) break;
    const largest = candidates.reduce((a, b) => (size(b.value) > size(a.value) ? b : a));
    const full = largest.value;
    // The most entries that fit, found by halving.
    let lo = 0;
    let hi = full.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      setAt(out, largest.path, full.slice(0, mid));
      if (size(out) + NOTE_ROOM <= budget) lo = mid;
      else hi = mid - 1;
    }
    setAt(out, largest.path, full.slice(0, lo));
    cut.add(largest.path.join('.'));
    truncated.push({ path: largest.path.join('.'), shown: lo, total: full.length });
  }
  return { data: out, truncated };
}

/**
 * What each refusal code means to someone asking about a design, and what to
 * try next. A code not listed gets the hub's message and the general advice.
 */
const MEANING: Record<string, string> = {
  person_filter_refused:
    "Armature does not list or count records by the person who made them, so that the design record is never turned into a measure of individuals' work (ADR-0021). Ask about the records instead: a record's attestations, its history, or what a branch changed.",
  not_found: 'No record with that id exists at this commit. Check the type and the id with find_records, or read another branch or commit.',
  unknown_type: 'The hub does not know that class. describe_schema lists the classes.',
  unknown_field: 'The class has no such field, or it belongs to an embedded part rather than the record. describe_schema lists each class with its fields.',
  unknown_ref: 'The hub holds no branch or commit by that name. list_branches gives each branch with its latest commit; record_history gives the commits that touched a record.',
  ambiguous_ref: 'Pass branch or ref, not both.',
  bad_query: "An argument is not in the form the hub reads: a number's digits only, true or false for a yes-or-no field.",
  unsupported_version: 'This hub does not serve the API revision this server relies on. describe_hub says which revisions it serves; the server needs updating, or the hub does.',
  unsupported_capability: 'This hub does not offer that part of the API. describe_hub lists what it offers.',
  forbidden: 'The hub does not let the configured person read this. ARMATURE_USER names who the server reads as.',
  not_registered: 'The configured person is not registered on this hub. ARMATURE_USER names who the server reads as.',
  // Writes (M4).
  precondition_failed: 'The branch has moved since the commit passed as basedOn: someone else wrote to it. Read what changed (branch_changes, or list_branches for the new commit), then file again with basedOn the new commit if the proposal still holds.',
  invariant_violation: "The proposal breaks one of Armature's rules, listed below; nothing was written. Correct it and file again.",
  invalid_document: 'The proposal is not in the shape the hub takes; nothing was written. The message says which field.',
  branch_exists: 'A branch by that name exists already. Choose another topic, or file on that branch if it is the proposal this conversation opened.',
  bad_name: 'The branch name is not one the hub accepts: letters, digits, dots, hyphens and underscores.',
  unknown_agent: 'ARMATURE_AGENT names no agent registered on this hub; a person registers it once (POST /users, an externalId starting agent:).',
  not_an_agent: 'ARMATURE_AGENT names a person, not an agent; it must name an agent registered on this hub.',
  remote_only: 'A workspace hub does not do that; on a workspace hub, file on the workspace itself.',
};

const GENERAL = 'Check the arguments, or call describe_hub to see what this hub serves.';

export function refusal(err: unknown): CallToolResult {
  if (err instanceof HubError) {
    const detail = { error: err.code, status: err.status, message: err.message, ...err.details };
    const remote = err.details.remote_needed ? ' The commit may be on the remote hub, which could not be reached; try again when it is online.' : '';
    const violations = Array.isArray(err.details.violations)
      ? (err.details.violations as Array<{ code?: string; field?: string; message?: string }>).map((v) => `\n- ${v.code ?? 'violation'}${v.field ? ` (${v.field})` : ''}: ${v.message ?? ''}`).join('')
      : '';
    return {
      isError: true,
      content: [{ type: 'text', text: `The hub refused (${err.status} ${err.code}): ${err.message}\n${MEANING[err.code] ?? GENERAL}${remote}${violations}` }],
      structuredContent: detail,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: 'text', text: `The hub could not be reached: ${message}. Is it running, and is ARMATURE_HUB_URL its address?` }],
    structuredContent: { error: 'hub_unreachable', message },
  };
}

/**
 * A refusal by the server itself, before the hub is asked (plan §4.5: the
 * server's own rules for writes): the same form as the hub's, without a status.
 */
export function refuse(code: string, message: string, next: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `This server refused (${code}): ${message}\n${next}` }],
    structuredContent: { error: code, message, refusedBy: 'armature-mcp' },
  };
}

/** Runs a tool's body, answering a refusal or an unreachable hub as a tool error. */
export async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    return refusal(err);
  }
}
