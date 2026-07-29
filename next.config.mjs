/** @type {import('next').NextConfig} */
// BASE_PATH can be overridden via env for local dev (e.g. BASE_PATH='' npm run dev)
const basePath = process.env.BASE_PATH ?? '/Research';

const nextConfig = {
  env: {
    NEXT_PUBLIC_CUSTOM_BASE_PATH: basePath,
  },
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath,
  assetPrefix: basePath,
  // Required for SharedArrayBuffer (WebGPU ONNX backend needs cross-origin isolation)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Cross-Origin-Opener-Policy',   value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy',  value: 'require-corp' },
        ],
      },
    ];
  },
};

export default nextConfig;
