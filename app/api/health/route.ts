export const dynamic = "force-dynamic";

// Unauthenticated liveness probe for Railway's healthcheck + uptime monitoring.
// Deliberately returns nothing sensitive — just that the server is up.
export async function GET() {
  return Response.json({ ok: true, service: "intelbot", ts: new Date().toISOString() });
}
