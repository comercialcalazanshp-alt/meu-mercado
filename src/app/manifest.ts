import type { MetadataRoute } from "next";

// Deixa o painel/PDV instalável como app no celular (PWA) — o Next injeta
// sozinho a tag <link rel="manifest"> em toda página que não sobrescrever
// isso. A vitrine de cada loja (/loja/[slug]) já tem o próprio manifest
// dinâmico por loja e continua funcionando normal, sem conflito.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meu Mercado — Painel",
    short_name: "Meu Mercado",
    description: "Painel do dono: PDV, produtos, pedidos, alertas e relatórios.",
    // Vai direto pro PDV — "/painel" sozinho só redireciona pra outra
    // página via JS depois de carregar (client-side), e se essa página
    // nunca tiver sido cacheada, o app não abre nada offline. Como o PDV é
    // a ferramenta que realmente precisa abrir sem internet, é ela quem
    // entra como porta de entrada do app instalado.
    start_url: "/painel/pdv",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#1e3a8a",
    icons: [
      { src: "/api/app-icon?size=192", sizes: "192x192", type: "image/png" },
      { src: "/api/app-icon?size=512", sizes: "512x512", type: "image/png" },
    ],
  };
}
