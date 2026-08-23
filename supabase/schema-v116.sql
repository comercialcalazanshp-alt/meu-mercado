-- Meu Mercado — v116.
-- Assistente de IA também pra dentro dos módulos de afiliado — mas cada
-- afiliado só enxerga os dados da própria loja dele (vendas, tráfego,
-- reclamações), nunca do Hub nem de outro afiliado, porque a rota já
-- filtra tudo por store_id (nenhuma mudança precisa aqui pra isso).
--
-- O que falta é o lado comercial: o dono do Hub cobra por esse recurso,
-- do mesmo jeito que já cobra por "Destaque na home" ou "Cupom próprio"
-- — reaproveita o catálogo de Extras pagos que já existe (mesma tela,
-- mesmo toggle por afiliado, mesmo preço editável), só adicionando um
-- extra novo chamado "Assistente de IA" nele.

-- Extra novo pra hub que ainda não existe (nasce junto com o Hub, como os
-- outros extras).
create or replace function public.seed_affiliate_defaults()
returns trigger
language plpgsql
as $$
begin
  insert into public.affiliate_extras (hub_store_id, code, name, price_monthly, included_in_padrao)
  values
    (new.hub_store_id, 'destaque_home', 'Destaque na home', 39.90, false),
    (new.hub_store_id, 'cupom_proprio', 'Cupom próprio', 19.90, false),
    (new.hub_store_id, 'banner_personalizado', 'Banner personalizado', 0, true),
    (new.hub_store_id, 'campanha_whatsapp', 'Campanha no WhatsApp', 29.90, false),
    (new.hub_store_id, 'relatorios_avancados', 'Relatórios avançados', 14.90, false),
    (new.hub_store_id, 'raspadinha_propria', 'Raspadinha própria', 19.90, false),
    (new.hub_store_id, 'assinatura_recorrente', 'Assinatura recorrente', 19.90, false),
    (new.hub_store_id, 'assistente_ia', 'Assistente de IA', 19.90, false)
  on conflict (hub_store_id, code) do nothing;

  insert into public.affiliate_ai_packages (hub_store_id, qty, price, is_custom)
  values
    (new.hub_store_id, 5, 12.50, false),
    (new.hub_store_id, 20, 45.00, false),
    (new.hub_store_id, 30, 60.00, false);

  return new;
end;
$$;

-- Backfill pros hubs que já existem hoje — sem isso só hub novo ganharia
-- o extra, e o preço/nome fica sempre editável depois na tela de Afiliados.
insert into public.affiliate_extras (hub_store_id, code, name, price_monthly, included_in_padrao)
select s.hub_store_id, 'assistente_ia', 'Assistente de IA', 19.90, false
from public.affiliate_settings s
on conflict (hub_store_id, code) do nothing;

-- Diz se uma loja específica pode usar o assistente: sim se ela não for
-- módulo de afiliado (Hub, ou loja comum sem parceria), ou se for
-- afiliado ativo com o extra "assistente_ia" ligado na própria parceria.
create or replace function public.affiliate_assistant_enabled(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select true
      from public.affiliate_partnerships p
      join public.affiliate_extras e on e.hub_store_id = p.hub_store_id and e.code = 'assistente_ia'
      join public.affiliate_partnership_extras pe on pe.partnership_id = p.id and pe.extra_id = e.id
      where p.module_store_id = p_store_id and p.active and pe.enabled
      limit 1
    ),
    not exists (
      select 1 from public.affiliate_partnerships p2 where p2.module_store_id = p_store_id and p2.active
    )
  );
$$;
