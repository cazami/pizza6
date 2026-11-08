-- ランキングを「ひとり1件（モードごと）」にする変更
-- Supabase の SQL Editor に貼り付けて「Run」で実行する（1回だけ。schema.sql の後）

-- ブラウザごとのランダムなID。一般公開の鍵からは読めない（列の権限を付けない）
alter table public.scores add column if not exists player_id uuid;

-- 同じ人・同じモードの記録は1件だけ
create unique index if not exists scores_player_mode_uniq on public.scores (player_id, mode);
