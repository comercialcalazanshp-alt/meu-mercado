import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Cabeçalhos básicos de segurança em toda resposta — nenhum deles
        // muda o comportamento do site pro usuário normal, só fecham
        // brechas comuns (clickjacking, MIME-sniffing, vazamento de URL
        // completa via referrer pra sites de terceiros linkados).
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
