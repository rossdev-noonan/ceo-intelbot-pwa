import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only document parsers that must not be bundled — loaded as external
  // packages at runtime. pdf-parse (PDF), mammoth (.docx), xlsx (Excel).
  // fflate (.zip/.pptx unzip) is pure-JS and bundles fine, so it's omitted.
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx"],
  // Route-handler request bodies are buffered (default 10MB) before our handler
  // reads them; a larger upload is silently truncated and req.formData() then
  // throws. Raise the limit above our 30MB per-file cap so big files (PDFs,
  // ZIPs) parse. NOTE: changing next.config requires a dev-server restart.
  experimental: { proxyClientMaxBodySize: "35mb" },
};

export default nextConfig;
