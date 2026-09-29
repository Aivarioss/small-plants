import { NextResponse, type NextRequest } from "next/server";
import { expiredSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  response.cookies.set(SESSION_COOKIE_NAME, "", expiredSessionCookieOptions());
  return response;
}
