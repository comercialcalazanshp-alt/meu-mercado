import "server-only";

// Busca o nome do produto pelo código de barras em bancos de dados públicos.
// Fica no servidor porque esses bancos bloqueiam chamadas direto do navegador (CORS).
// Tenta o Open Food Facts primeiro; se não achar, tenta o UPCitemdb.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim();
  if (!code) {
    return Response.json({ found: false });
  }

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,image_url`,
    );
    if (res.ok) {
      const data = await res.json();
      const productName: string | undefined = data?.product?.product_name;
      if (data?.status === 1 && productName) {
        const brand: string | undefined = data.product.brands;
        return Response.json({
          found: true,
          name: brand ? `${productName} - ${brand.split(",")[0]}` : productName,
          image_url: data.product.image_url || null,
        });
      }
    }
  } catch {
    // tenta o próximo banco
  }

  try {
    const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`);
    if (res.ok) {
      const data = await res.json();
      const item = data?.items?.[0];
      if (data?.code === "OK" && item?.title) {
        return Response.json({
          found: true,
          name: item.title as string,
          image_url: (item.images?.[0] as string) || null,
        });
      }
    }
  } catch {
    // sem sorte nesse banco também
  }

  return Response.json({ found: false });
}
