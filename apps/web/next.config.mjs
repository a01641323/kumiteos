/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@karate/core"],
  // The web app always exports to a fully static `out/` directory, which
  // apps/local serves as `express.static`.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;
