import type { FindingInput } from './intelligence/index.js';
import { SCHEMA_ID } from './intelligence/index.js';

/*
 * Sending a reviewed submission to a discovery server (docs/intelligence,
 * phase 3). Called only after decideUpload() allowed it and the user
 * approved the exact payloads (views/discoveryView.ts). The token travels in
 * the Authorization header and is never part of an error, a log line or the
 * submission history. A failure is reported and never blocks PeopleSoft
 * Studio.
 */

export type SubmitResult =
  | { ok: true; outcome: 'created' | 'merged' | 'duplicate'; remoteId: string; status: string }
  | { ok: false; httpStatus?: number; error: string };

export async function submitFinding(serverUrl: string, token: string, payload: FindingInput, timeoutMs = 15000): Promise<SubmitResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverUrl}/api/v1/findings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'psft-finding-schema': SCHEMA_ID },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'error'
    });
    const body = await res.json().catch(() => undefined) as { outcome?: string; finding?: { id?: string; status?: string }; title?: string; violations?: Array<{ path: string; rule: string }>; issues?: Array<{ path: string; message: string }> } | undefined;
    if (res.ok && body?.outcome && body.finding?.id) {
      return { ok: true, outcome: body.outcome as 'created', remoteId: body.finding.id, status: body.finding.status ?? '' };
    }
    const detail = [...(body?.violations ?? []).map((v) => `${v.path} (${v.rule})`), ...(body?.issues ?? []).map((v) => `${v.path} (${v.message})`)].slice(0, 5).join('; ');
    return { ok: false, httpStatus: res.status, error: `${body?.title ?? res.statusText ?? 'Refused'}${detail ? `: ${detail}` : ''}` };
  } catch (error) {
    const e = error as Error;
    return { ok: false, error: e.name === 'AbortError' ? `No answer within ${timeoutMs / 1000} s.` : `Could not reach the server (${e.message}).` };
  } finally {
    clearTimeout(timer);
  }
}
