import { auth, authEnabled } from "@/auth";

// Next 16 renamed Middleware -> Proxy. This is the OPTIMISTIC redirect for UX;
// the real authorization is enforced server-side inside the protected routes
// (see requireUser() in auth.ts and the /api/chat guard).
const guarded = auth((req) => {
  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/signin") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/manifest") ||
    pathname.includes(".");

  if (!isPublic && !req.auth) {
    const url = new URL("/signin", req.nextUrl.origin);
    return Response.redirect(url);
  }
});

// Only enforce when M365 SSO is configured; otherwise a no-op (local dev),
// which also avoids running Auth (and needing AUTH_SECRET) when auth is off.
const proxy = authEnabled ? guarded : () => undefined;
export default proxy;

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
