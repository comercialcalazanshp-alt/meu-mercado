-- Meu Mercado — v31.
-- Assinatura recorrente pro cliente final: até aqui só o dono conseguia
-- cadastrar uma assinatura pra um cliente (em Assinaturas, no painel). Agora
-- o próprio cliente pode assinar um kit direto pela vitrine, sem precisar
-- pedir pro dono fazer isso — ela cai na mesma lista de Assinaturas do
-- painel, pronta pra gerar o pedido do mês.

drop policy if exists "cliente assina kit ativo de loja ativa" on subscriptions;
create policy "cliente assina kit ativo de loja ativa" on subscriptions for insert
  with check (
    trim(customer_phone) <> ''
    and exists (
      select 1 from kits k
      join stores s on s.id = k.store_id
      where k.id = subscriptions.kit_id
        and k.id is not null
        and k.active = true
        and s.id = subscriptions.store_id
        and s.active = true
    )
  );
