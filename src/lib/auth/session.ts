import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "small_plants_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

type SessionPayload = {
  exp: number;
  iat: number;
};

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function expiredSessionCookieOptions() {
  return {
    ...sessionCookieOptions(),
    maxAge: 0,
  };
}

export function isPasswordConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.APP_SESSION_SECRET);
}

export function validateSharedPassword(password: string): boolean {
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    return false;
  }

  return constantTimeEqual(password, expected);
}

export async function createSessionToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = await sign(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export async function hasValidSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) {
    return false;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return false;
  }

  const expectedSignature = await sign(encodedPayload);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionPayload;
    return Number.isFinite(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function sign(value: string): Promise<string> {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret) {
    return "";
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let result = left.length === right.length ? 0 : 1;

  for (let index = 0; index < maxLength; index += 1) {
    result |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return result === 0;
}

function base64UrlEncode(value: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}
