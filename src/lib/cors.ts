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

/** CORS for the authenticated metrics endpoint, scoped to the dashboard origin. */
export function setMetricsCors(res: Response, allowedOrigin: string): void {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function isPreflight(req: Request): boolean {
  return req.method === 'OPTIONS';
}
