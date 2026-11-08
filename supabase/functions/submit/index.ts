// ピザ六等分 ランキング登録（Supabase Edge Function）
// 受け取るのは「切った線」。点数はここで計算し直して保存する（送られてきた点数は信用しない）。
// ひとり（ブラウザごとのID）・モードごとに1件。自己ベストのときだけ記録を更新する。
// 配置: supabase functions deploy submit --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

// ---- ゲームと同じ定数・計算（index.html と必ず一致させる） ----
const N_VERTS = 720;
const MAX_CUTS = 30;
const NAME_MAX = 10;
const NG_WORDS = ['しね', 'ころす', 'ちんこ', 'ちんぽ', 'まんこ', 'せっくす', 'れいぷ', 'きちがい', 'がいじ',
  'fuck', 'shit', 'sex', 'nigger', 'nigga', 'http', 'www'];
// これ以上の記録は「保留」にして、管理者が確認してから表示する
const PENDING_SCORE = 99.95;
const PENDING_FAST_MS = 2000;   // じっくり・せっかちで3回切るのにこれより速い

type Poly = number[][];
function circlePoly(n: number): Poly {
  const p: Poly = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    p.push([Math.cos(a), Math.sin(a)]);
  }
  return p;
}
function area(poly: Poly): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return Math.abs(s) / 2;
}
function split(poly: Poly, n: number[], d: number): Poly[] {
  const A: Poly = [], B: Poly = [];
  const len = poly.length;
  for (let i = 0; i < len; i++) {
    const c = poly[i], q = poly[(i + 1) % len];
    const sc = c[0] * n[0] + c[1] * n[1] - d;
    const sq = q[0] * n[0] + q[1] * n[1] - d;
    if (sc >= 0) A.push(c);
    if (sc <= 0) B.push(c);
    if ((sc > 0 && sq < 0) || (sc < 0 && sq > 0)) {
      const t = sc / (sc - sq);
      const p = [c[0] + (q[0] - c[0]) * t, c[1] + (q[1] - c[1]) * t];
      A.push(p); B.push(p);
    }
  }
  return [A, B].filter(p => p.length >= 3 && area(p) > 1e-10);
}
const normalOf = (th: number) => [-Math.sin(th), Math.cos(th)];
const TOTAL = area(circlePoly(N_VERTS));
function scoreOf(lines: number[][]): number {
  let pieces: Poly[] = [circlePoly(N_VERTS)];
  for (const [th, d] of lines) {
    const n = normalOf(th);
    const next: Poly[] = [];
    for (const p of pieces) next.push(...split(p, n, d));
    pieces = next;
  }
  const fr = pieces.map(p => area(p) / TOTAL).sort((a, b) => b - a);
  let err = 0;
  fr.forEach((a, i) => { err += Math.abs(a - (i < 6 ? 1 / 6 : 0)); });
  for (let i = fr.length; i < 6; i++) err += 1 / 6;
  return Math.round(Math.max(0, 100 - err * 100) * 100) / 100;
}

function cleanName(s: string): string {
  return s.normalize('NFKC').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function nameError(n: string): string {
  const len = [...n].length;
  if (!len) return '名前を入れてください';
  if (len > NAME_MAX) return `${NAME_MAX}文字までにしてください`;
  const k = n.toLowerCase().replace(/[\s._\-・]/g, '')
    .replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  if (NG_WORDS.some(w => k.includes(w))) return 'その名前は使えません';
  return '';
}
function jstDayStartISO(): string {
  const d = new Date(Date.now() + 9 * 3600e3);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 9 * 3600e3).toISOString();
}

// ---- HTTP ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const bad = (msg: string) => json({ error: msg }, 400);

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return bad('送信内容が読めませんでした'); }
  const { mode, lines, whiffs, timeMs } = body ?? {};

  // ---- 入力チェック ----
  if (!['normal', 'timed', 'free'].includes(mode)) return bad('モードが正しくありません');
  const name = cleanName(String(body?.name ?? ''));
  const nerr = nameError(name);
  if (nerr) return bad(nerr);
  if (!Array.isArray(lines) || lines.length < 1) return bad('記録が正しくありません');
  for (const l of lines) {
    if (!Array.isArray(l) || l.length !== 2) return bad('記録が正しくありません');
    const [th, d] = l;
    if (!Number.isFinite(th) || !Number.isFinite(d) || Math.abs(th) > 4 || Math.abs(d) >= 0.995) {
      return bad('記録が正しくありません');
    }
  }
  if (!Number.isInteger(whiffs) || whiffs < 0) return bad('記録が正しくありません');
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 3_600_000) return bad('記録が正しくありません');
  if (mode === 'normal' && (lines.length !== 3 || whiffs !== 0)) return bad('記録が正しくありません');
  if (mode === 'timed' && lines.length + whiffs !== 3) return bad('記録が正しくありません');
  if (mode === 'free' && (lines.length > MAX_CUTS || whiffs !== 0)) return bad('記録が正しくありません');

  const playerId = String(body?.playerId ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(playerId)) return bad('記録が正しくありません');

  // ---- 点数を計算し直す ----
  const score = scoreOf(lines);
  const cuts = lines.length;
  const pending = score >= PENDING_SCORE || (mode !== 'free' && timeMs < PENDING_FAST_MS);
  // 並び順の2番目（同点のとき小さい方が上）
  const tieCol = mode === 'free' ? 'cuts' : 'time_ms';
  const tieVal = mode === 'free' ? cuts : timeMs;

  // ---- ひとり1件：同じ人・同じモードの記録があれば、良いときだけ更新 ----
  const { data: old, error: e1 } = await db.from('scores')
    .select('id, score, cuts, time_ms, approved, created_at')
    .eq('player_id', playerId).eq('mode', mode).maybeSingle();
  if (e1) return json({ error: '保存できませんでした' }, 500);

  let row: { id: number; score: number; tie: number; approved: boolean; created_at: string };
  let updated: boolean;
  const oldScore = old ? Number(old.score) : -1;
  const oldTie = old ? (mode === 'free' ? old.cuts : old.time_ms) : 0;
  if (!old || score > oldScore || (score === oldScore && tieVal < oldTie)) {
    const rec = { mode, name, score, cuts, time_ms: timeMs, lines, approved: !pending, player_id: playerId,
      created_at: new Date().toISOString() };
    const q = old
      ? db.from('scores').update(rec).eq('id', old.id)
      : db.from('scores').insert(rec);
    const { data, error } = await q.select('id, created_at').single();
    if (error) return json({ error: '保存できませんでした' }, 500);
    row = { id: data.id, score, tie: tieVal, approved: !pending, created_at: data.created_at };
    updated = true;
  } else {
    // 自己ベストではない：記録はそのまま、名前だけ最新にする
    const { error } = await db.from('scores').update({ name }).eq('id', old.id);
    if (error) return json({ error: '保存できませんでした' }, 500);
    row = { id: old.id, score: oldScore, tie: oldTie, approved: old.approved, created_at: old.created_at };
    updated = false;
  }

  const base = { id: row.id, score, best: row.score, updated };
  if (!row.approved) return json({ ...base, pending: true });

  // ---- 順位（自分より上の件数 + 1） ----
  const better = `score.gt.${row.score},and(score.eq.${row.score},${tieCol}.lt.${row.tie}),` +
    `and(score.eq.${row.score},${tieCol}.eq.${row.tie},created_at.lt."${row.created_at}")`;
  const countAbove = async (since?: string) => {
    let q = db.from('scores').select('id', { count: 'exact', head: true })
      .eq('mode', mode).eq('approved', true).or(better);
    if (since) q = q.gte('created_at', since);
    const { count } = await q;
    return (count ?? 0) + 1;
  };
  const today = jstDayStartISO();
  const isToday = new Date(row.created_at).getTime() >= new Date(today).getTime();
  const [rankAll, rankToday] = await Promise.all([countAbove(), isToday ? countAbove(today) : Promise.resolve(null)]);
  return json({ ...base, pending: false, rankAll, rankToday });
});
