type Faq = {
  question: string;
  answer: string;
};

type Section = {
  title: string;
  items: Faq[];
};

const SECTIONS: Section[] = [
  {
    title: "Produtos e vitrine",
    items: [
      {
        question: "Como o cliente encontra minha loja?",
        answer:
          "Cada loja tem um link próprio: meumercado.app/loja/seu-slug (veja o link certinho em Início). Compartilhe esse link no WhatsApp, Instagram ou gere o cartaz com QR code em Cartaz.",
      },
      {
        question: "O produto sumiu da vitrine, o que houve?",
        answer:
          "Produtos com estoque zerado continuam na lista mas aparecem como \"Sem estoque\" pro cliente. Se você desativou o produto (ou ele nunca foi marcado como ativo), ele some da vitrine — confira em Produtos.",
      },
      {
        question: "Dá pra vender em kit/combo com desconto?",
        answer:
          "Sim, em Kits você monta um combo com os produtos que quiser e define um preço fechado, diferente da soma dos itens avulsos.",
      },
    ],
  },
  {
    title: "Pedidos e entrega",
    items: [
      {
        question: "Como eu fico sabendo de um pedido novo?",
        answer:
          "Toca um som e aparece um aviso no canto da tela assim que o pedido é criado, enquanto você estiver com o painel aberto. Dá pra silenciar o som no sininho ao lado do nome da loja. O pedido também fica listado em Pedidos.",
      },
      {
        question: "Como funciona o frete por bairro?",
        answer:
          "Em Frete você cadastra os bairros que atende e o valor de cada entrega. No checkout o cliente escolhe o bairro (ou retirar na loja, sempre grátis) e o frete entra automático no total — o valor final não pode ser adulterado pelo cliente.",
      },
      {
        question: "Posso limitar o horário em que a loja recebe pedido?",
        answer:
          "Sim, em Minha conta você liga o horário de funcionamento, define os dias e o horário, e ainda pode fechar a loja na hora (feriado, imprevisto). Fora do horário o cliente só consegue ver o catálogo, não fecha pedido.",
      },
    ],
  },
  {
    title: "PDV (venda no balcão)",
    items: [
      {
        question: "Pra que serve o PDV?",
        answer:
          "É pra registrar venda presencial, no balcão — sem passar pelo carrinho do site. Você bipa ou busca o produto, escolhe a forma de pagamento e finaliza; o estoque desconta igual a um pedido do site.",
      },
      {
        question: "O PDV também dá cashback e desconta cupom?",
        answer:
          "O PDV é uma venda separada do fluxo de cashback/cupom do site — ele foi feito pra ser rápido no balcão. Cashback e cupons valem pro checkout feito pelo cliente no site.",
      },
    ],
  },
  {
    title: "Cupons, cashback e indicação",
    items: [
      {
        question: "Qual a diferença entre cupom e cashback?",
        answer:
          "Cupom é um código que você cria manualmente (ex: BEMVINDO10) com desconto fixo ou percentual, com prazo e limite de uso opcionais. Cashback é automático: você define uma porcentagem em Cashback e todo pedido pago devolve esse saldo pro cliente usar na próxima compra.",
      },
      {
        question: "Como funciona o programa de indicação?",
        answer:
          "Cada cliente ganha um código próprio depois do primeiro pedido. Se um amigo usar esse código numa compra, os dois recebem o bônus configurado em Cashback → Bônus por indicação, uma única vez.",
      },
    ],
  },
  {
    title: "Fiado e despesas",
    items: [
      {
        question: "O fiado do PDV soma com o fiado de outros pedidos?",
        answer:
          "Sim, o saldo de fiado é por cliente (telefone) dentro da sua loja, não importa se a compra foi pelo site ou no balcão. Acompanhe tudo em Fiado.",
      },
      {
        question: "Pra que serve a tela de Despesas?",
        answer:
          "Pra registrar custos fora da venda (aluguel, fornecedor, conta de luz) e ver quanto sobra de fato no mês, cruzando com o que entrou nas vendas em Relatórios.",
      },
    ],
  },
  {
    title: "Campanhas e clientes",
    items: [
      {
        question: "A campanha no WhatsApp envia mensagem sozinha?",
        answer:
          "Não. Em Campanhas você escolhe um grupo de clientes e escreve a mensagem, mas cada envio abre o WhatsApp já preenchido pra você conferir e mandar manualmente, um por um. Nada é disparado automático.",
      },
      {
        question: "Onde vejo o aniversário e o saldo de cada cliente?",
        answer:
          "Em Cashback: lá aparecem os aniversariantes do mês (com botão pra gerar cupom de presente) e todo cliente com saldo de cashback disponível.",
      },
    ],
  },
  {
    title: "Minha conta",
    items: [
      {
        question: "Como troco o nome ou o WhatsApp da loja?",
        answer: "Em Minha conta, no bloco \"Dados da loja\".",
      },
      {
        question: "Dá pra excluir minha loja?",
        answer:
          "Sim, em Minha conta, na área vermelha no final da página. Isso apaga a loja, produtos, pedidos, cupons e todo o histórico de fiado — não tem como desfazer.",
      },
    ],
  },
];

export default function Ajuda() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Central de ajuda</h1>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Dúvidas comuns sobre como cada parte do painel funciona.
      </p>

      <div className="mt-6 space-y-6">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {section.title}
            </h2>
            <div className="mt-2 space-y-2">
              {section.items.map((item) => (
                <details
                  key={item.question}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
                >
                  <summary className="cursor-pointer font-medium text-slate-900 dark:text-slate-50">
                    {item.question}
                  </summary>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
