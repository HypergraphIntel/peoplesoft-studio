/*
 * Whether this installation may submit findings, and where to
 * (docs/intelligence/SECURITY_PRIVACY.md). Pure: the extension gathers the
 * inputs -- settings, VS Code's telemetry level, the machine policy file --
 * and every reason a submission is not allowed comes back, in order.
 *
 * The machine policy is a file an administrator owns (policyFileLocations):
 * a user setting cannot override it. Uploads are off unless every gate
 * opens: no policy forbids them, VS Code telemetry is not off, the user chose
 * "manual", a server is set, and it is HTTPS (plain HTTP only to this
 * machine, for development). "manual" still means the user approves each
 * submission after seeing its payload.
 */

export type UploadMode = 'off' | 'manual';

export interface MachinePolicy {
  intelligence?: {
    /** "disabled" forbids submissions on this machine whatever the user sets. */
    uploads?: 'disabled' | 'allowed';
    /** When set, the only server this machine may submit to. */
    serverUrl?: string;
  };
}

export interface UploadInputs {
  uploadMode: UploadMode;
  serverUrl: string;
  /** VS Code's telemetry.telemetryLevel. */
  telemetryLevel: string;
  policy?: MachinePolicy;
  /** The machine policy file exists but could not be read: fail closed. */
  policyError?: string;
}

export interface UploadDecision {
  allowed: boolean;
  /** Where submissions go when allowed (the policy's server wins). */
  serverUrl?: string;
  reasons: string[];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Where the machine policy may be, by platform: system locations only an administrator writes. */
export function policyFileLocations(platform: string, env: Record<string, string | undefined>): string[] {
  if (platform === 'win32') return [`${env.ProgramData ?? 'C:\\ProgramData'}\\PeopleSoftStudio\\policy.json`];
  if (platform === 'darwin') return ['/Library/Application Support/PeopleSoftStudio/policy.json'];
  return ['/etc/peoplesoft-studio/policy.json'];
}

export function decideUpload(i: UploadInputs): UploadDecision {
  const reasons: string[] = [];
  if (i.policyError) reasons.push(`The machine policy could not be read (${i.policyError}); submissions stay off.`);
  const policy = i.policy?.intelligence;
  if (policy?.uploads === 'disabled') reasons.push('The machine policy disables submissions on this machine.');
  if (i.telemetryLevel === 'off') reasons.push('VS Code telemetry is off (telemetry.telemetryLevel): PeopleSoft Studio sends nothing.');
  if (i.uploadMode !== 'manual') reasons.push('Submissions are off (peoplesoft.intelligence.uploadMode).');
  const pinned = policy?.serverUrl?.trim();
  const chosen = i.serverUrl.trim();
  if (pinned && chosen && chosen !== pinned) reasons.push(`The machine policy allows only ${pinned}; peoplesoft.intelligence.serverUrl names another server.`);
  const url = pinned || chosen;
  if (!url) reasons.push('No discovery server is set (peoplesoft.intelligence.serverUrl).');
  else {
    let parsed: URL | undefined;
    try { parsed = new URL(url); } catch { reasons.push('The discovery server URL is not a URL.'); }
    if (parsed) {
      if (parsed.username || parsed.password) reasons.push('The discovery server URL must not carry credentials (the token is kept in VS Code\'s secret storage).');
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname))) {
        reasons.push('The discovery server must use HTTPS (plain HTTP only to this machine).');
      }
    }
  }
  return reasons.length ? { allowed: false, reasons } : { allowed: true, serverUrl: url.replace(/\/+$/, ''), reasons: [] };
}
