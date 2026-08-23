-- Meu Mercado — v107.
-- Reclamação já avisa o dono na hora (schema-v79, notify_new_complaint).
-- Avaliação ruim (nota 1 ou 2) da loja não avisava nada — o dono só via
-- se abrisse Avaliações por conta própria. Mesmo padrão exato da
-- reclamação, só troca a tabela/rota e o gatilho (só dispara pra nota
-- baixa, não qualquer avaliação).
alter table public.stores add column if not exists bad_review_notification_enabled boolean not null default true;

create or replace function public.notify_bad_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  if new.rating > 2 then
    return new;
  end if;

  select bad_review_notification_enabled into v_enabled from public.stores where id = new.store_id;

  if coalesce(v_enabled, true) then
    perform net.http_post(
      url := 'https://meu-mercado-blond.vercel.app/api/push/send-review-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-secret', '287b8dfeda0b85a9219e22d49e16fd0e05a1ef345aa661f1'
      ),
      body := jsonb_build_object(
        'store_id', new.store_id,
        'customer_name', new.customer_name,
        'rating', new.rating
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_bad_review_insert on public.store_reviews;
create trigger on_bad_review_insert
  after insert on public.store_reviews
  for each row execute function public.notify_bad_review();
