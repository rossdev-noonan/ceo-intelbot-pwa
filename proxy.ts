import { auth } from "@/auth";

// Next 16 renamed Middleware -> Proxy. This is the OPTIMISTIC redirect for UX;
// the real authorization is enforced server-side inside the protected routes
// (see requireUser() in auth.ts and the /api/chat guard).
export default auth((req) => {
  // Auth disabled (no Entra config, e.g. local dev) — let everything through.
  if (!process.env.AUTH_MICROSOFT_ENTRA_ID_ID) return;

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

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
