#!/usr/bin/env node
/* Инструмент облачного агента «Любимого тела». Секретов в файле нет — они приходят в переменных окружения.
   TELO_KEY   — ключ журнала (base64, 32 байта), TELO_TOKEN — токен агента, TELO_URL — адрес Worker'а.

   node telo.mjs pull [дней=7]          → /tmp/telo-data: day-ГГГГ-ММ-ДД.json, photos/*.jpg, profile.md, catalog.json
   node telo.mjs advice morning file.json → утренний план в приложение
   node telo.mjs advice week file.json    → недельный разбор и рецепты повара
   node telo.mjs notify "Заголовок" "Текст"
   node telo.mjs doc profile file.md      → обновить профиль (правила питания и тела)                    */
import fs from 'fs'; import path from 'path';
const URL_ = process.env.TELO_URL || 'https://telo-push.36stasy11stasy36.workers.dev';
const KEY = process.env.TELO_KEY, TOKEN = process.env.TELO_TOKEN;
if (!KEY || !TOKEN) { console.error('Нужны TELO_KEY и TELO_TOKEN'); process.exit(1) }
const s = globalThis.crypto.subtle, b64 = b => Buffer.from(b).toString('base64'), ub64 = t => new Uint8Array(Buffer.from(t, 'base64'));
const key = await s.importKey('raw', ub64(KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
async function seal(obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await s.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj))); return { iv: b64(iv), ct: b64(new Uint8Array(ct)) } }
async function open(box) { const pt = await s.decrypt({ name: 'AES-GCM', iv: ub64(box.iv) }, key, ub64(box.ct)); return new TextDecoder().decode(pt) }
async function api(p, opt = {}) { const r = await fetch(URL_ + p, { ...opt, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, ...(opt.headers || {}) } }); const t = await r.text(); if (!r.ok) throw new Error(p + ' → ' + r.status + ' ' + t.slice(0, 200)); return JSON.parse(t) }

const DATA = process.env.TELO_DATA || '/tmp/telo-data'; // вне репозитория: личные данные никогда не попадут в git
const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'pull') {
  const out = DATA, ph = path.join(out, 'photos'); fs.mkdirSync(ph, { recursive: true });
  const { days } = await api('/j?days=' + (+a1 || 7)); let nPh = 0;
  for (const { d, box } of days) {
    const j = JSON.parse(await open(box));
    for (const p of j.photos || []) { const t = new Date(p.at); const f = `${d}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}_${p.pid}.jpg`; fs.writeFileSync(path.join(ph, f), Buffer.from((p.jpg || '').split(',')[1] || '', 'base64')); p.file = 'photos/' + f; delete p.jpg; nPh++ }
    fs.writeFileSync(path.join(out, `day-${d}.json`), JSON.stringify(j, null, 1));
  }
  for (const name of ['profile', 'catalog']) { const r = await api('/doc/' + name); if (r.box) fs.writeFileSync(path.join(out, name === 'profile' ? 'profile.md' : 'catalog.json'), await open(r.box)) }
  console.log(`✓ дней: ${days.length} (${days.map(x => x.d).join(', ')}), фото: ${nPh}. Папка ${DATA}`);
} else if (cmd === 'pending') {
  /* нужен ли сейчас план дня: она нажала «Спланировать мой день» позже последнего плана, или уже 10:30, а плана на сегодня нет */
  const { days } = await api('/j?days=2'), today = new Date().toISOString().slice(0, 10);
  let req = 0; const pids = [];
  for (const { box } of days) { const j = JSON.parse(await open(box)); req = Math.max(req, +(j.keys?.['planReq_' + today] || 0)); for (const m of j.keys?.meals || []) if (m.pid) pids.push(m.pid) }
  let adv = null; const r = await api('/advice/morning'); if (r.box) adv = JSON.parse(await open(r.box));
  let food = {}; const rf = await api('/advice/food'); if (rf.box) food = JSON.parse(await open(rf.box)).items || {};
  const msk = new Date(Date.now() + 3 * 36e5), mm = msk.getUTCHours() * 60 + msk.getUTCMinutes(), mskDate = msk.toISOString().slice(0, 10);
  const planToday = adv && adv.date === mskDate, newPh = pids.filter(p => !food[p]);
  const out = [];
  if (req && (!adv || (adv.at || 0) < req)) out.push('ПЛАН: она написала дела и попросила план дня');
  else if (!planToday && mm >= 10 * 60 + 30 && mm < 13 * 60) out.push('ПЛАН: плана на сегодня ещё нет — собери из того, что есть');
  if (newPh.length) out.push('ФОТО: новых фото еды без разбора: ' + newPh.length + ' (pid: ' + newPh.join(', ') + ')');
  console.log(out.length ? out.join('\n') : 'НЕТ ЗАПРОСА');
} else if (cmd === 'food' && a1) {
  /* разбор фото: {"pid":{"dish","palms","iron","veg","tip"}} — дописывается к прошлым разборам */
  const add = JSON.parse(fs.readFileSync(a1, 'utf8')); let items = {}; const rf = await api('/advice/food'); if (rf.box) items = JSON.parse(await open(rf.box)).items || {};
  for (const [k, v] of Object.entries(add)) items[k] = { ...v, at: Date.now() };
  const keep = Object.entries(items).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 300);
  await api('/advice/food', { method: 'POST', body: JSON.stringify({ box: await seal({ at: Date.now(), items: Object.fromEntries(keep) }) }) }); console.log('✓ разбор фото отправлен:', Object.keys(add).length);
} else if (cmd === 'advice' && ['morning', 'week'].includes(a1) && a2) {
  const obj = JSON.parse(fs.readFileSync(a2, 'utf8')); obj.at = Date.now();
  await api('/advice/' + a1, { method: 'POST', body: JSON.stringify({ box: await seal(obj) }) }); console.log('✓ отправлено в приложение:', a1);
} else if (cmd === 'notify') {
  const r = await api('/notify', { method: 'POST', body: JSON.stringify({ title: a1, body: a2 || '' }) }); console.log('✓ уведомлений отправлено:', r.sent);
} else if (cmd === 'doc' && a1 && a2) {
  await api('/doc/' + a1, { method: 'POST', body: JSON.stringify({ box: await seal(fs.readFileSync(a2, 'utf8')) }) }); console.log('✓ документ обновлён:', a1);
} else { console.error('Команды: pull [дней] | advice morning|week file.json | notify "заголовок" "текст" | doc profile file.md'); process.exit(1) }
