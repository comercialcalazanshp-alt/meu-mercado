export const metadata = {
  title: "Termo de Uso — Meu Mercado",
};

export default function Termos() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 text-slate-700 dark:text-slate-300">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Termo de Uso</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Última atualização: agosto de 2026
      </p>

      <div className="mt-6 space-y-5 text-sm leading-relaxed">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">O que é o Meu Mercado</h2>
          <p className="mt-1">
            O Meu Mercado é uma plataforma que permite que donos de mercadinhos e pequenas lojas
            criem sua própria loja online. A plataforma cuida da parte técnica (cadastro,
            catálogo, carrinho, pedidos); cada loja é independente e administrada pelo próprio
            dono.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">
            Responsabilidade pelas vendas
          </h2>
          <p className="mt-1">
            O Meu Mercado não vende produtos diretamente e não participa da relação comercial
            entre a loja e o cliente. Preço, disponibilidade, qualidade dos produtos, prazo de
            entrega e forma de pagamento são de responsabilidade exclusiva de cada loja. Dúvidas,
            trocas ou problemas com um pedido devem ser resolvidos diretamente com o dono da loja.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">
            Conta de dono de loja
          </h2>
          <p className="mt-1">
            Ao criar uma loja, você é responsável por manter suas informações corretas e sua
            senha em segurança. Você pode excluir sua conta e sua loja a qualquer momento pelo
            painel — essa ação é permanente e apaga todos os produtos, pedidos e demais dados da
            loja.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Uso adequado</h2>
          <p className="mt-1">
            Não é permitido usar a plataforma para vender produtos ilegais, cadastrar informações
            falsas ou tentar burlar a segurança do sistema. Contas usadas dessa forma podem ser
            desativadas.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Mudanças neste termo</h2>
          <p className="mt-1">
            Este termo pode ser atualizado conforme a plataforma evolui. Mudanças relevantes serão
            refletidas na data no topo desta página.
          </p>
        </div>
      </div>
    </div>
  );
}
