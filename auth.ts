import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Auth is ENFORCED whenever the Entra app registration is configured (i.e. in
// production / once Ross adds the env vars). With no Entra config, auth is off
// so local dev still works without locking us out.
export const authEnabled = !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;

// Allowlist — only these accounts may sign in (Mike + a break-glass admin).
// Comma-separated emails in INTELBOT_ALLOWED_EMAILS. Empty = allow anyone in the
// tenant (the single-tenant app registration already restricts to the org).
const ALLOWED = (process.env.INTELBOT_ALLOWED_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function emailOf(p: Record<string, unknown> | null | undefined): string {
  return (
    (p?.email as string) ||
    (p?.preferred_username as string) ||
    (p?.upn as string) ||
    ""
  )
    .toString()
    .toLowerCase();
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET || "intelbot-dev-secret-change-in-production",
  providers: [MicrosoftEntraID],
  pages: { signIn: "/signin" },
  callbacks: {
    // Enforce the allowlist at sign-in.
    async signIn({ profile }) {
      if (!ALLOWED.length) return true;
      return ALLOWED.includes(emailOf(profile));
    },
  },
});

// Server-side gate for protected routes (API + server components). Returns
// { ok:false } when auth is enabled and the caller isn't a signed-in,
// allowlisted user. Returns { ok:true } when auth is disabled (local dev).
export async function requireUser(): Promise<{ ok: boolean; email?: string }> {
  if (!authEnabled) return { ok: true };
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!session) return { ok: false };
  if (ALLOWED.length && (!email || !ALLOWED.includes(email))) return { ok: false };
  return { ok: true, email: email ?? undefined };
}
