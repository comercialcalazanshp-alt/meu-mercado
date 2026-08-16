-- Alertas automáticos (schema-v75) precisavam de um agendador batendo em
-- /api/cron/check-alerts a cada 15min. O Vercel Cron do plano Hobby só
-- permite frequência diária (deploy chegou a ser recusado por causa disso
-- — vercel.json com "*/15 * * * *" foi removido). Troca pro mesmo padrão
-- já usado em notify_new_order() (schema-v35): pg_cron dentro do próprio
-- Supabase chamando a rota via pg_net, sem depender do plano do Vercel.

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('check-alerts');
exception when others then
  null;
end $$;

select cron.schedule(
  'check-alerts',
  '*/15 * * * *',
  $$
  select net.http_get(
    url := 'https://meu-mercado-blond.vercel.app/api/cron/check-alerts',
    headers := jsonb_build_object('Authorization', 'Bearer e6780f16d14c52b664700cd8b0b209dce74afc8569ee4c16bd683e071ebfbb00')
  );
  $$
);
