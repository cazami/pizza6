-- ピザ六等分 ランキング用テーブル
-- Supabase の SQL Editor に貼り付けて「Run」で実行する（1回だけ）

create table if not exists public.scores (
  id         bigint generated always as identity primary key,
  mode       text        not null check (mode in ('normal', 'timed', 'free')),
  name       text        not null check (char_length(name) between 1 and 10),
  score      numeric(5,2) not null check (score between 0 and 100),
  cuts       int         not null,
  time_ms    int         not null,
  lines      jsonb       not null,               -- 切った線 [[角度, 距離], ...]（点数の検算用）
  player_id  uuid,                                -- ブラウザごとのランダムなID（ひとり1件にするため。非公開）
  approved   boolean     not null default true,  -- false = 保留（管理画面で true にすると表示される）
  created_at timestamptz not null default now()
);

create index if not exists scores_rank_idx on public.scores (mode, approved, score desc, created_at);
create unique index if not exists scores_player_mode_uniq on public.scores (player_id, mode);

-- 誰でも読めるのは「承認済み」の記録だけ。書き込みは Edge Function（サーバー側）からのみ
alter table public.scores enable row level security;

drop policy if exists "read approved" on public.scores;
create policy "read approved" on public.scores
  for select to anon, authenticated
  using (approved);

-- 一般公開の鍵からは、切った線（lines）は読めないようにする
revoke all on public.scores from anon, authenticated;
grant select (id, mode, name, score, cuts, time_ms, approved, created_at) on public.scores to anon, authenticated;
