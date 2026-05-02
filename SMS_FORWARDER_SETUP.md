# 📱 MozPay — Configuração da Verificação Automática por SMS

Este guia explica, passo a passo, como pôr a funcionar o sistema que **lê automaticamente** as mensagens de confirmação do M-Pesa, E-Mola e mKesh para creditar depósitos e activar investimentos sem intervenção manual.

> **Visão geral do funcionamento**
>
> 1. O utilizador faz a transferência no telemóvel para o número da MozPay.
> 2. A operadora envia um SMS de confirmação para o **SIM da MozPay**.
> 3. A app **SMS Forwarder** (instalada nesse telemóvel) reencaminha o SMS, em tempo real, para o servidor MozPay (endpoint `/api/sms-webhook`).
> 4. O servidor regista o SMS no Supabase (`sms_log`).
> 5. A tela "Aguardando confirmação" no telemóvel do utilizador, em tempo real, vê o SMS chegar, compara com o pedido pendente e, se bater certo: credita o saldo (depósito) ou activa o nível (investimento).
> 6. Se nada bater certo em 5 minutos, o pedido é rejeitado com explicação.

---

## Parte 1 — Preparar o Supabase (uma única vez)

Abre o Supabase ➜ projecto `fbojmxiwvubepoywdhhc` ➜ menu lateral **SQL Editor** ➜ **New query** ➜ cola e executa:

```sql
-- ============================================================
-- 1. Tabela de SMS recebidos (caixa de entrada)
-- ============================================================
create table if not exists public.sms_log (
  id           bigserial primary key,
  raw_from     text not null,
  raw_body     text not null,
  received_at  timestamptz not null default now(),
  raw_payload  jsonb,
  matched_payment_id bigint
);
create index if not exists sms_log_received_at_idx on public.sms_log (received_at desc);

alter table public.sms_log enable row level security;

-- O webhook (servidor) escreve com a anon key.
-- Os utilizadores autenticados leem para reagir em tempo real.
drop policy if exists "sms_log anon insert" on public.sms_log;
create policy "sms_log anon insert" on public.sms_log
  for insert to anon with check (true);

drop policy if exists "sms_log read all" on public.sms_log;
create policy "sms_log read all" on public.sms_log
  for select to anon, authenticated using (true);

drop policy if exists "sms_log update all" on public.sms_log;
create policy "sms_log update all" on public.sms_log
  for update to anon, authenticated using (true) with check (true);

-- Activar realtime para a tabela
alter publication supabase_realtime add table public.sms_log;

-- ============================================================
-- 2. Tabela de pedidos pendentes (depósitos/investimentos a confirmar)
-- ============================================================
create table if not exists public.pending_payments (
  id           bigserial primary key,
  user_id      uuid not null,
  user_phone   text,
  type         text not null check (type in ('deposit','investment')),
  method       text not null check (method in ('mpesa','emola','mkesh')),
  amount       numeric(12,2) not null,
  level_rank   text,
  level_name   text,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  reason       text,
  matched_sms_id bigint,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default (now() + interval '10 minutes'),
  approved_at  timestamptz
);
create index if not exists pending_payments_user_idx on public.pending_payments (user_id, created_at desc);
create index if not exists pending_payments_status_idx on public.pending_payments (status, created_at desc);

alter table public.pending_payments enable row level security;

drop policy if exists "pp owner all" on public.pending_payments;
create policy "pp owner all" on public.pending_payments
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "pp admin read" on public.pending_payments;
create policy "pp admin read" on public.pending_payments
  for select to anon using (true);

drop policy if exists "pp admin update" on public.pending_payments;
create policy "pp admin update" on public.pending_payments
  for update to anon using (true) with check (true);

alter publication supabase_realtime add table public.pending_payments;

-- ============================================================
-- 3. Configuração do webhook (chave-secreta + filtros de remetente)
-- ============================================================
-- A chave-secreta do webhook é gerada automaticamente pelo painel
-- admin no primeiro acesso à secção "Verificação Automática SMS".
-- Os filtros de remetente são opcionais e configuráveis por aí também.
```

✅ Quando o SQL acima correr sem erros, está pronto.

---

## Parte 2 — Gerar a chave-secreta do webhook

1. Abre o site ➜ segura o logo da MozPay durante 10 segundos na tela de manutenção (ou vai a `/admin.html` directamente).
2. Coloca a senha `GLOKKSPAZ40123`.
3. No menu lateral, clica em **Configurações**.
4. Desce até à nova secção **Verificação Automática SMS**.
5. Clica no botão **"Gerar chave-secreta"** — o sistema cria uma chave aleatória e mostra-a.
6. Vais ver dois campos prontos para copiar:
   - **URL do webhook**: `https://<o-teu-dominio>.replit.dev/api/sms-webhook`
   - **Chave-secreta** (cabeçalho `X-Webhook-Secret`): `…uma string longa…`

> Guarda os dois — vais precisar deles na Parte 3.

---

## Parte 3 — Instalar e configurar a app **SMS Forwarder**

1. No telemóvel que tem o SIM da MozPay, abre a **Play Store**.
2. Procura por **"SMS Forwarder"** e instala uma das opções compatíveis (qualquer uma serve, basta que permita encaminhar SMS via HTTP POST com cabeçalhos personalizáveis):
   - **"SMS Forwarder"** por *bogkonstantin* (recomendada — open source).
   - **"SMS to URL"**.
   - **"SMSGate"**.
3. Abre a app e dá-lhe permissão para ler SMS (Android vai pedir).
4. Adiciona uma nova regra de encaminhamento (**"Add rule"** / **"Nova regra"**):
   - **Tipo**: HTTP / Webhook.
   - **URL**: a URL que copiaste no admin (ex.: `https://abcd.replit.dev/api/sms-webhook`).
   - **Método**: `POST`.
   - **Cabeçalhos personalizados** (Custom headers):
     - `Content-Type: application/json`
     - `X-Webhook-Secret: <chave-secreta-que-copiaste-do-admin>`
   - **Corpo (Body / Template)** — JSON com placeholders da app (mantém EXACTAMENTE este formato):
     ```json
     {"from":"%from%","text":"%text%","sentStamp":%sentStamp%}
     ```
     > Em algumas apps os placeholders chamam-se `{from}`, `{message}`, `{timestamp}`. Adapta — o servidor aceita também: `sender`/`message`/`receivedAt` e `from`/`body`/`timestamp`.
   - **Filtro de remetente** (opcional mas recomendado): aplica a regra só para mensagens vindas de:
     - `M-Pesa`, `MPESA`, `Vodacom` (M-Pesa)
     - `eMola`, `EMOLA`, `Movitel` (E-Mola)
     - `mKesh`, `MKESH`, `Tmcel` (mKesh)
5. Guarda a regra e activa-a.
6. **Teste**: faz uma transferência de teste (pequena, ex. 1 MT) para o número da MozPay. Em poucos segundos o SMS vai chegar ao SIM, ser encaminhado para o webhook e aparecer:
   - No painel admin ➜ **Configurações** ➜ secção SMS, na tabela "Últimas mensagens recebidas".
   - Na tabela `sms_log` do Supabase.

---

## Parte 4 — Como o utilizador vê o fluxo

1. **Depósito**: utilizador escolhe método, valor, e cola o ID da transferência ➜ clica **Confirmar Depósito**.
2. Aparece a tela **"Aguardando confirmação"** com contador.
3. Faz a transferência real no telemóvel para o número MozPay.
4. SMS chega ➜ servidor regista ➜ tela do utilizador detecta em tempo real ➜ saldo é creditado ➜ tela muda para **"Pagamento concluído"**.
5. Se não bater certo em **5 minutos** (timeout), aparece **"Pedido rejeitado"** com explicação. O utilizador pode tentar de novo.

Para investimento o fluxo é idêntico, mas em vez de creditar saldo activa o nível escolhido.

---

## Parte 5 — Troubleshooting

| Problema | Possível causa | Solução |
|---|---|---|
| Webhook devolve 401 | Cabeçalho `X-Webhook-Secret` errado ou em falta | Gerar nova chave no admin e copiar exactamente |
| Webhook devolve 503 | Chave-secreta ainda não foi gerada no admin | Ir ao admin ➜ Configurações ➜ "Gerar chave-secreta" |
| Webhook devolve 502 | Política RLS na tabela `sms_log` em falta | Re-correr o SQL da Parte 1 |
| SMS chega mas pedido continua pendente | Valor ou remetente não bate com o pedido | Verificar o "Filtro de remetente" e o valor exacto da transferência |
| Tela diz "Aguardando" mas nunca muda | Dispositivo perdeu a sessão realtime | O temporizador de 5 min vai marcar como rejeitado; tentar de novo |

---

## Anexo — Resposta esperada do webhook

Bem-sucedido (HTTP 200):
```json
{ "ok": true }
```

Erros possíveis:
- `401 { "ok": false, "error": "invalid secret" }` — cabeçalho errado
- `503 { "ok": false, "error": "webhook not configured" }` — chave não gerada no admin
- `400 { "ok": false, "error": "missing from/body" }` — payload inválido
- `502 { "ok": false, "error": "persist failed", "detail": "…" }` — falhou a escrever no Supabase
