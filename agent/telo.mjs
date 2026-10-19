#!/usr/bin/env node
/* Инструмент облачного агента «Любимого тела». Секретов в файле нет — они приходят в переменных окружения.
   TELO_KEY   — ключ журнала (base64, 32 байта), TELO_TOKEN — токен агента, TELO_URL — адрес Worker'а.

   node telo.mjs pull [дней=7]          → ./data: day-ГГГГ-ММ-ДД.json, photos/*.jpg, profile.md, catalog.json
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

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'pull') {
  const out = 'data', ph = path.join(out, 'photos'); fs.mkdirSync(ph, { recursive: true });
  const { days } = await api('/j?days=' + (+a1 || 7)); let nPh = 0;
  for (const { d, box } of days) {
    const j = JSON.parse(await open(box));
    for (const p of j.photos || []) { const t = new Date(p.at); const f = `${d}_${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}_${p.pid}.jpg`; fs.writeFileSync(path.join(ph, f), Buffer.from((p.jpg || '').split(',')[1] || '', 'base64')); p.file = 'photos/' + f; delete p.jpg; nPh++ }
    fs.writeFileSync(path.join(out, `day-${d}.json`), JSON.stringify(j, null, 1));
  }
  for (const name of ['profile', 'catalog']) { const r = await api('/doc/' + name); if (r.box) fs.writeFileSync(path.join(out, name === 'profile' ? 'profile.md' : 'catalog.json'), await open(r.box)) }
  console.log(`✓ дней: ${days.length} (${days.map(x => x.d).join(', ')}), фото: ${nPh}. Папка ./data`);
} else if (cmd === 'advice' && ['morning', 'week'].includes(a1) && a2) {
  const obj = JSON.parse(fs.readFileSync(a2, 'utf8')); obj.at = Date.now();
  await api('/advice/' + a1, { method: 'POST', body: JSON.stringify({ box: await seal(obj) }) }); console.log('✓ отправлено в приложение:', a1);
} else if (cmd === 'notify') {
  const r = await api('/notify', { method: 'POST', body: JSON.stringify({ title: a1, body: a2 || '' }) }); console.log('✓ уведомлений отправлено:', r.sent);
} else if (cmd === 'doc' && a1 && a2) {
  await api('/doc/' + a1, { method: 'POST', body: JSON.stringify({ box: await seal(fs.readFileSync(a2, 'utf8')) }) }); console.log('✓ документ обновлён:', a1);
} else { console.error('Команды: pull [дней] | advice morning|week file.json | notify "заголовок" "текст" | doc profile file.md'); process.exit(1) }
