-- =============================================================
-- MozPay – Correcção de Segurança: Activar RLS em todas as tabelas
-- Execute este SQL no Supabase Dashboard → SQL Editor
-- ATENÇÃO: execute primeiro num ambiente de teste se possível
-- =============================================================

-- ---------------------------------------------------------------
-- 1. WALLETS – cada utilizador vê/edita apenas a sua própria carteira
-- ---------------------------------------------------------------
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wallets_select_own" ON wallets;
DROP POLICY IF EXISTS "wallets_insert_own" ON wallets;
DROP POLICY IF EXISTS "wallets_update_own" ON wallets;

CREATE POLICY "wallets_select_own" ON wallets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "wallets_insert_own" ON wallets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "wallets_update_own" ON wallets
  FOR UPDATE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 2. TRANSACTIONS – cada utilizador vê apenas as suas transacções
-- ---------------------------------------------------------------
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transactions_select_own" ON transactions;
DROP POLICY IF EXISTS "transactions_insert_own" ON transactions;

CREATE POLICY "transactions_select_own" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "transactions_insert_own" ON transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 3. NOTIFICATIONS – utilizador vê as suas + notificações globais (user_id IS NULL)
-- ---------------------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON notifications;

CREATE POLICY "notifications_select_own" ON notifications
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

-- ---------------------------------------------------------------
-- 4. USER_PREFERENCES – cada utilizador vê/edita as suas preferências
-- ---------------------------------------------------------------
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_preferences_select_own" ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_insert_own" ON user_preferences;
DROP POLICY IF EXISTS "user_preferences_update_own" ON user_preferences;

CREATE POLICY "user_preferences_select_own" ON user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_preferences_insert_own" ON user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_preferences_update_own" ON user_preferences
  FOR UPDATE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 5. ONLINE_USERS – todos podem ver presença; apenas própria linha pode ser gerida
-- ---------------------------------------------------------------
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "online_users_select_all" ON online_users;
DROP POLICY IF EXISTS "online_users_insert_own" ON online_users;
DROP POLICY IF EXISTS "online_users_update_own" ON online_users;
DROP POLICY IF EXISTS "online_users_delete_own" ON online_users;

CREATE POLICY "online_users_select_all" ON online_users
  FOR SELECT USING (true);

CREATE POLICY "online_users_insert_own" ON online_users
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "online_users_update_own" ON online_users
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "online_users_delete_own" ON online_users
  FOR DELETE USING (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 6. CHAT_MESSAGES – utilizador vê apenas as suas conversas
-- ---------------------------------------------------------------
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_select_own" ON chat_messages;
DROP POLICY IF EXISTS "chat_insert_own" ON chat_messages;

CREATE POLICY "chat_select_own" ON chat_messages
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "chat_insert_own" ON chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 7. PENDING_PAYMENTS – utilizador vê apenas os seus pagamentos
-- ---------------------------------------------------------------
ALTER TABLE pending_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_payments_select_own" ON pending_payments;
DROP POLICY IF EXISTS "pending_payments_insert_own" ON pending_payments;

CREATE POLICY "pending_payments_select_own" ON pending_payments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "pending_payments_insert_own" ON pending_payments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 8. REFUND_REQUESTS – utilizador vê apenas os seus pedidos de reembolso
-- ---------------------------------------------------------------
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "refund_select_own" ON refund_requests;
DROP POLICY IF EXISTS "refund_insert_own" ON refund_requests;

CREATE POLICY "refund_select_own" ON refund_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "refund_insert_own" ON refund_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 9. WITHDRAWAL_REQUESTS – utilizador vê apenas os seus levantamentos
-- ---------------------------------------------------------------
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wd_select_own" ON withdrawal_requests;
DROP POLICY IF EXISTS "wd_insert_own" ON withdrawal_requests;

CREATE POLICY "wd_select_own" ON withdrawal_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "wd_insert_own" ON withdrawal_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 10. ADMIN_MESSAGES – utilizador vê/envia as suas mensagens (via sender_id)
-- ---------------------------------------------------------------
ALTER TABLE admin_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_msg_select_own" ON admin_messages;
DROP POLICY IF EXISTS "admin_msg_insert_own" ON admin_messages;

CREATE POLICY "admin_msg_select_own" ON admin_messages
  FOR SELECT USING (auth.uid() = sender_id);

CREATE POLICY "admin_msg_insert_own" ON admin_messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- ---------------------------------------------------------------
-- 11. INVITE_CODES – utilizador vê os seus próprios códigos
-- ---------------------------------------------------------------
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invite_select_own" ON invite_codes;
DROP POLICY IF EXISTS "invite_insert_own" ON invite_codes;

CREATE POLICY "invite_select_own" ON invite_codes
  FOR SELECT USING (auth.uid() = created_by OR auth.uid() = used_by_user_id);

CREATE POLICY "invite_insert_own" ON invite_codes
  FOR INSERT WITH CHECK (auth.uid() = created_by);

-- ---------------------------------------------------------------
-- 12. SMS_LOG – apenas service role (admin). Sem políticas = ninguém acede via anon
-- ---------------------------------------------------------------
ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;
-- Sem policies: apenas service_role (usado pelo servidor proxy) consegue aceder

-- ---------------------------------------------------------------
-- 13. LOGIN_ATTEMPTS – apenas service role
-- ---------------------------------------------------------------
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies: apenas service_role

-- ---------------------------------------------------------------
-- 14. SECURITY_LIMITS – apenas service role
-- ---------------------------------------------------------------
ALTER TABLE security_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies: apenas service_role

-- ---------------------------------------------------------------
-- 15. TRANSACTION_AUDIT – apenas service role
-- ---------------------------------------------------------------
ALTER TABLE transaction_audit ENABLE ROW LEVEL SECURITY;
-- Sem policies: apenas service_role

-- ---------------------------------------------------------------
-- 16. SYSTEM_SETTINGS – leitura pública (usado pelo app para manutenção/config)
--     Escrita apenas via service role
-- ---------------------------------------------------------------
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings_public_read" ON system_settings;

CREATE POLICY "settings_public_read" ON system_settings
  FOR SELECT USING (true);

-- =============================================================
-- NOTAS IMPORTANTES:
-- • O service_role (usado pelo servidor proxy) ignora SEMPRE o RLS
--   → admin.html através do proxy funciona sem problemas
-- • A chave anon sem JWT de utilizador → acesso negado a dados privados
-- • Rotacione a service_role_key no Supabase Dashboard → Settings → API
--   (a chave foi partilhada em texto nesta conversa)
-- =============================================================
