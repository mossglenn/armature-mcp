/**
 * What a tool returns (plan §5, question 9, decided 2026-11-21 (b)): a short
 * summary the server writes from the hub's answer, then the hub's JSON. The
 * numbers come from code and the model explains them; a client that reads
 * structured content gets the whole answer there. M1 adds the size budget.
 *
 * A hub refusal is a tool error, not a protocol error (M1's "refusals as tool
 * errors"): the model reads the hub's code and message, which say what was
 * refused and why, and can explain them or try another way.
 */
import { HubError } from '@armature/client';
import type { CallToolResult } from '@modelcontextprotocol/server';

export function answer(summary: string, data: Record<string, unknown>): CallToolResult {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(data, null, 2) },
    ],
    structuredContent: data,
  };
}

export function refusal(err: unknown): CallToolResult {
  if (err instanceof HubError) {
    const detail = { error: err.code, status: err.status, message: err.message, ...err.details };
    return {
      isError: true,
      content: [{ type: 'text', text: `The hub refused (${err.status} ${err.code}): ${err.message}` }],
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

/** Runs a tool's body, answering a refusal or an unreachable hub as a tool error. */
export async function guarded(body: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await body();
  } catch (err) {
    return refusal(err);
  }
}
