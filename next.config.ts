import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only document parsers that must not be bundled — loaded as external
  // packages at runtime. pdf-parse (PDF), mammoth (.docx), xlsx (Excel).
  // fflate (.zip/.pptx unzip) is pure-JS and bundles fine, so it's omitted.
  serverExternalPackages: ["pdf-parse", "mammoth", "xlsx"],
};

export default nextConfig;
