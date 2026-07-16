export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  return null;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError("Malformed session token", 401);
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    return JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
  } catch {
    throw new HttpError("Malformed session token", 401);
  }
}

/**
 * Every intent-sending function requires a valid Supabase (anonymous) JWT.
 *
 * All of these functions are deployed with verify_jwt = true, so Supabase's
 * edge gateway has already cryptographically verified this token's signature
 * (against the project JWT secret) and its expiry BEFORE our code runs - an
 * unverified or expired token never reaches here. So we don't re-verify; we
 * just read the subject out of the payload. This drops the ~100-200ms network
 * round trip that auth.getUser() used to add to every single action. We still
 * defensively re-check the token is present, well-formed, and not expired.
 */
export function requireUserId(req: Request): string {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError("Missing Authorization header", 401);

  const payload = decodeJwtPayload(token);
  const sub = payload.sub;
  const exp = payload.exp;
  if (typeof exp === "number" && exp * 1000 <= Date.now()) {
    throw new HttpError("Session expired", 401);
  }
  if (typeof sub !== "string" || sub.length === 0) {
    throw new HttpError("Invalid session token", 401);
  }
  return sub;
}

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
