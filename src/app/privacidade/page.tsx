export const metadata = {
  title: "Aviso de Privacidade — Meu Mercado",
};

export default function Privacidade() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-12 text-slate-700 dark:text-slate-300">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Aviso de Privacidade</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
        Última atualização: agosto de 2026
      </p>

      <div className="mt-6 space-y-5 text-sm leading-relaxed">
        <p>
          O Meu Mercado é uma plataforma que hospeda lojas online independentes. Cada loja é
          administrada pelo próprio dono, que decide quais produtos vender e recebe os pedidos
          feitos por clientes. Este aviso explica quais dados a plataforma coleta e o que
          acontece com eles.
        </p>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">
            Quais dados coletamos
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              <strong>De quem cria uma loja:</strong> nome da loja, e-mail, senha (guardada de
              forma criptografada) e WhatsApp.
            </li>
            <li>
              <strong>De quem faz um pedido:</strong> nome, WhatsApp e os itens escolhidos. Não é
              preciso criar conta para comprar.
            </li>
            <li>
              <strong>De quem avalia um produto:</strong> nome, nota e comentário (opcional).
            </li>
          </ul>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">
            Para que usamos esses dados
          </h2>
          <p className="mt-1">
            Só para o que é necessário pra loja funcionar: processar o pedido, permitir que o
            dono da loja entre em contato pelo WhatsApp, e mostrar avaliações de produtos pra
            outros clientes. Não vendemos nem compartilhamos esses dados com terceiros pra fins
            de publicidade.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Quem vê seus dados</h2>
          <p className="mt-1">
            O dono da loja onde você fez o pedido vê seu nome, WhatsApp e os itens comprados —
            é o que permite ele entregar seu pedido. A plataforma Meu Mercado tem acesso técnico
            aos dados de todas as lojas pra manter o sistema funcionando, mas não usa esses dados
            pra nenhuma outra finalidade.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Seus direitos</h2>
          <p className="mt-1">
            Você pode pedir a exclusão dos seus dados de pedido diretamente ao dono da loja onde
            comprou (pelo WhatsApp informado na página da loja). Se você é dono de uma loja no
            Meu Mercado, pode apagar sua conta e todos os dados associados a qualquer momento
            pelo painel, na seção &quot;Configurações&quot;.
          </p>
        </div>

        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">Cookies</h2>
          <p className="mt-1">
            Usamos apenas os cookies necessários pra manter você conectado ao painel da sua loja
            (se você for dono de uma). Não usamos cookies de rastreamento publicitário.
          </p>
        </div>
      </div>
    </div>
  );
}
