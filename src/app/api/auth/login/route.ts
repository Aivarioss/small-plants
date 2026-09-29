import { NextResponse, type NextRequest } from "next/server";
import {
  createSessionToken,
  isPasswordConfigured,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  validateSharedPassword,
} from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");

  if (!isPasswordConfigured()) {
    return NextResponse.redirect(new URL("/login?error=config", request.url), { status: 303 });
  }

  if (!validateSharedPassword(password)) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), { status: 303 });
  }

  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, await createSessionToken(), sessionCookieOptions());
  return response;
}
