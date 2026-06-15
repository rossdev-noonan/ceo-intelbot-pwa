import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker / Azure App Service deploy
  // (see docs/deployment-and-security-plan.md). Emits .next/standalone with a
  // minimal node_modules so the runtime image stays small. Ignored by Vercel.
  output: "standalone",
  // Node-only document parsers that must not be bundled — loaded as external
  // packages at runtime. mammoth (.docx), xlsx (Excel). PDFs now use unpdf,
  // which ships a server-native pdf.js build and bundles fine. fflate
  // (.zip/.pptx unzip) is pure-JS and bundles too, so both are omitted.
  serverExternalPackages: ["mammoth", "xlsx"],
  // Route-handler request bodies are buffered (default 10MB) before our handler
  // reads them; a larger upload is silently truncated and req.formData() then
  // throws. Raise the limit above our 30MB per-file cap so big files (PDFs,
  // ZIPs) parse. NOTE: changing next.config requires a dev-server restart.
  experimental: { proxyClientMaxBodySize: "35mb" },
};

export default nextConfig;
