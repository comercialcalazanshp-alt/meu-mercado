-- Corrige o rastreio de tráfego: RPC única e atômica em vez de insert/select/update
-- direto na tabela pelo cliente anônimo (o select público falhava por RLS e o
-- contador de page_views nunca incrementava).

drop policy if exists "qualquer um registra visita" on site_visits;
drop policy if exists "qualquer um atualiza a propria sessao" on site_visits;

create or replace function track_site_visit(
  p_store_id uuid,
  p_session_id text,
  p_mark_converted boolean default false,
  p_count_view boolean default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into site_visits (store_id, session_id, converted)
  values (p_store_id, p_session_id, p_mark_converted)
  on conflict (store_id, session_id) do update
    set page_views = site_visits.page_views + (case when p_count_view then 1 else 0 end),
        last_seen_at = now(),
        converted = site_visits.converted or excluded.converted;
end;
$$;

grant execute on function track_site_visit(uuid, text, boolean) to anon, authenticated;
