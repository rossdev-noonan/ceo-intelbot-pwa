import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (and its pdfjs dependency) is a Node-only library that must not be
  // bundled — load it as an external package at runtime.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
