-- Meu Mercado — v114.
-- Tráfego mostrava total de visitas, mas não de onde vieram (WhatsApp,
-- Instagram, Google, link direto) — o dono nunca sabia qual canal de
-- divulgação realmente trazia gente. "source" só é gravado na primeira
-- visita da sessão (não entra no "on conflict do update", fica travado
-- na origem real de quando a pessoa chegou pela primeira vez).
alter table public.site_visits add column if not exists source text;

-- Sem isso, o Postgres deixaria as duas versões (4 e 5 parâmetros)
-- convivendo — create or replace só troca quando a assinatura é
-- idêntica. Já vimos esse mesmo problema com checkout()/checkout_hub()
-- (v100): duas versões coexistindo dá "Could not choose the best
-- candidate function" pra quem chamar sem o novo parâmetro.
drop function if exists public.track_site_visit(uuid, text, boolean, boolean);

create or replace function public.track_site_visit(
  p_store_id uuid,
  p_session_id text,
  p_mark_converted boolean default false,
  p_count_view boolean default true,
  p_source text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into site_visits (store_id, session_id, converted, source)
  values (p_store_id, p_session_id, p_mark_converted, p_source)
  on conflict (store_id, session_id) do update
    set page_views = site_visits.page_views + (case when p_count_view then 1 else 0 end),
        last_seen_at = now(),
        converted = site_visits.converted or excluded.converted;
end;
$$;

grant execute on function track_site_visit(uuid, text, boolean, boolean, text) to anon, authenticated;
