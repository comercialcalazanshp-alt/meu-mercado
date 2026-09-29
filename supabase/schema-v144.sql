-- Meu Mercado — v144.
-- Corrige o backfill da v143: a dívida migrada do "sistema antigo" tinha
-- ganhado vencimento = data da migração (01/01/2026), que não era um
-- vencimento combinado com o cliente — era só quando a dívida entrou no
-- sistema novo. Resultado: hoje (29/09) todas apareciam com ~271 dias de
-- atraso de uma vez, e 17 clientes foram bloqueados no mesmo instante, sem
-- nenhum deles ter tido chance real de pagar dentro de um prazo.
--
-- Corrige dando o mesmo prazo padrão de uma venda nova (Configurações →
-- Crediário → prazo em dias), contado a partir de HOJE — e desbloqueia
-- automaticamente quem só estava bloqueado por causa disso (nunca mexe em
-- bloqueio manual, mesma trava de sempre em apply_credit_auto_block).
update public.credit_transactions ct
set due_date = (current_date + (coalesce(s.credit_term_days, 30) || ' days')::interval)::date
from public.credit_customers cc
join public.stores s on s.id = cc.store_id
where ct.customer_id = cc.id
  and ct.type = 'venda'
  and ct.note = 'Dívida do sistema antigo';

select public.apply_credit_auto_block();
