// Auth for /metrics (Firebase ID token) and /rollup (Cloud Scheduler OIDC).
// Design D10 (metrics) and D14/task 5.3 (rollup).

import { OAuth2Client } from 'google-auth-library';
import { auth } from '../firestore.js';
import { config } from '../config.js';

export interface AuthOk {
  ok: true;
  email: string;
}
export interface AuthErr {
  ok: false;
  status: 401 | 403;
  error: string;
}
export type AuthResult = AuthOk | AuthErr;

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? (m[1] ?? null) : null;
}

/**
 * Verify a Firebase ID token and enforce the email allowlist (D10).
 * Never trusts a plain header — the signed token is the boundary (C3).
 */
export async function verifyMetricsCaller(
  authorization: string | undefined,
): Promise<AuthResult> {
  const token = bearer(authorization);
  if (!token) return { ok: false, status: 401, error: 'missing bearer token' };

  let email: string | undefined;
  try {
    const decoded = await auth().verifyIdToken(token);
    email = decoded.email?.toLowerCase();
  } catch {
    return { ok: false, status: 401, error: 'invalid token' };
  }
  if (!email) return { ok: false, status: 403, error: 'token has no email' };
  if (!config.allowlistEmails.includes(email)) {
    return { ok: false, status: 403, error: 'not allowlisted' };
  }
  return { ok: true, email };
}

const oauthClient = new OAuth2Client();

/**
 * Verify that a /rollup request comes from Cloud Scheduler (task 5.3).
 *
 * Accepts either:
 *   - a Google-signed OIDC token whose email matches SCHEDULER_SA_EMAIL
 *     (and audience matches ROLLUP_AUDIENCE when configured), or
 *   - a matching ROLLUP_ADMIN_TOKEN bearer, for manual/local invocation
 *     (documented, off unless the env var is set).
 *
 * Rejects unauthenticated public callers so the endpoint on the public `api`
 * service cannot be triggered by anyone.
 */
export async function verifyRollupCaller(
  authorization: string | undefined,
): Promise<AuthResult> {
  const token = bearer(authorization);
  if (!token) return { ok: false, status: 401, error: 'missing bearer token' };

  // Manual admin token path (optional).
  if (config.rollupAdminToken && token === config.rollupAdminToken) {
    return { ok: true, email: 'admin-token' };
  }

  // Cloud Scheduler OIDC path.
  if (!config.schedulerSaEmail) {
    return { ok: false, status: 403, error: 'rollup caller identity not configured' };
  }
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken: token,
      audience: config.rollupAudience || undefined,
    });
    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase();
    const verified = payload?.email_verified;
    if (!email || !verified) {
      return { ok: false, status: 403, error: 'unverified token email' };
    }
    if (email !== config.schedulerSaEmail) {
      return { ok: false, status: 403, error: 'caller not authorized' };
    }
    return { ok: true, email };
  } catch {
    return { ok: false, status: 401, error: 'invalid OIDC token' };
  }
}
