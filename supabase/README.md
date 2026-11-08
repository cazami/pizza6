# ランキングの準備（Supabase）

プロジェクト: https://bxfgjfeaevvmafjfonce.supabase.co

## 更新：ランキングを「ひとり1件」にする（2026-11 追加）
すでに 1〜2 を済ませている場合は、これだけ行う。
1. **SQL Editor** に [`migrate-002-one-per-player.sql`](migrate-002-one-per-player.sql) の中身を貼り付けて **Run**
2. **Edge Functions** → `submit` → **Code** を開き、中身を [`functions/submit/index.ts`](functions/submit/index.ts) の最新に貼り替えて **Deploy**（JWT の検証はオフのまま）

必ず 1 → 2 の順で。逆にすると、新しいプログラムが存在しない列を使おうとして登録が失敗します。

## 1. テーブルを作る（1回だけ）
1. Supabase の管理画面で、左メニューの **SQL Editor** を開く
2. [`schema.sql`](schema.sql) の中身をすべて貼り付けて **Run**
3. 「Success. No rows returned」と出ればOK

## 2. 登録用のプログラム（Edge Function）を置く
1. 左メニューの **Edge Functions** →「Deploy a new function」→「Via Editor」
2. 関数名を **`submit`** にする（この名前でないと動きません）
3. エディタの中身を消して、[`functions/submit/index.ts`](functions/submit/index.ts) の中身をすべて貼り付けて **Deploy**
4. デプロイ後、関数の **Details**（または Settings）で **「Verify JWT with legacy secret」（JWT の検証）をオフ** にして保存
   - ゲームは publishable key で呼び出すため、ここがオンだと登録が失敗します

CLI を使う場合は `supabase functions deploy submit --no-verify-jwt` でも同じです。

## 3. 管理のしかた
左メニューの **Table Editor** → `scores` テーブル
- **削除**：行を選んで Delete
- **保留の承認**：`approved` が `false` の行（99.95点以上や、じっくり・せっかちで2秒未満の記録）を確認し、問題なければ `true` に変える。不正っぽければ削除
- `lines` 列には切った線が入っています（点数の検算用。一般には公開されません）

## 注意
- Secret key（`sb_secret_…`）はリポジトリや画面に書かないでください。Edge Function は Supabase が自動で渡す鍵を使うので、自分で設定する必要はありません
- 点数の計算は `index.html` と `functions/submit/index.ts` に同じものが入っています。片方を変えたら、もう片方も同じに直してください
