// CORS helpers (design D2).
//
// /track is permissive and, because sendBeacon with a text/plain body is a CORS
// "simple request", incurs no preflight. /metrics uses an Authorization header
// (not simple), so it must answer a preflight and echo the dashboard origin.

import type { Request, Response } from 'express';

/** Permissive CORS for the public ingest endpoint. */
export function setTrackCors(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * CORS for the authenticated metrics endpoint.
 * allowedOrigins is a comma-separated list (DASH_ORIGIN env var).
 * Only the matching origin is echoed back — never a wildcard.
 */
export function setMetricsCors(
  req: Request,
  res: Response,
  allowedOrigins: string,
): void {
  const origins = allowedOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  const requestOrigin = req.get('origin') ?? '';
  const matched = origins.find((o) => o === requestOrigin) ?? origins[0] ?? '';
  res.setHeader('Access-Control-Allow-Origin', matched);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function isPreflight(req: Request): boolean {
  return req.method === 'OPTIONS';
}
