'use strict';
/**
 * GEWON — server nối cửa hàng (index.html) với khu vực nhân viên (staff.html).
 * Không cần cài thư viện: chỉ dùng module có sẵn của Node.js (>= 18).
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 node server.js
 *
 * Dữ liệu lưu trong data/db.json (đơn hàng, sản phẩm, đánh giá, chat, tài khoản).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

/* ------------------------------------------------------------------ cấu hình */
const PORT = Number(process.env.PORT) || 3000;
// Trên Render (có biến PORT/RENDER) phải nghe 0.0.0.0; chạy trên máy cá nhân thì mặc định 127.0.0.1.
const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = điện thoại cùng Wi-Fi / tunnel truy cập được (đặt HOST=127.0.0.1 nếu chỉ muốn máy này)
const TRUST_PROXY = process.env.TRUST_PROXY === '1' || (process.env.TRUST_PROXY !== '0' && !!process.env.RENDER);
const PROD = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
const SECURE_COOKIE = process.env.COOKIE_SECURE === '1' || PROD;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const SEED_FILE = path.join(ROOT, 'data', 'seed-products.json'); // luôn nằm cạnh code, kể cả khi DATA_DIR là ổ đĩa riêng
const RATE = 25000; // tỉ giá USD→VND mà cửa hàng đang dùng để hiển thị giá
const MAX_BODY = 100 * 1024;
const SESSION_IDLE_MS = 12 * 3600e3;
const SESSION_MAX_MS = 7 * 24 * 3600e3;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ tiện ích */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const sqlTime = (d = new Date()) => d.toISOString().slice(0, 19).replace('T', ' '); // UTC "YYYY-MM-DD HH:MM:SS"
const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^84(?=\d{9}$)/, '0');
const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'san-pham';
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const rid = (n = 18) => crypto.randomBytes(n).toString('base64url');

const SIZE_SETS = {
  c: ['XS', 'S', 'M', 'L', 'XL'],
  b: ['28', '30', '32', '34', '36'],
  s: ['40', '41', '42', '43', '44', '45'],
  a: ['One size'],
};
const CATEGORIES = { outer: 'c', tops: 'c', bottoms: 'b', shoes: 's', acc: 'a' };
const STATUS = {
  pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', preparing: 'Đang chuẩn bị',
  shipped: 'Đang giao', delivered: 'Đã giao', cancelled: 'Đã hủy',
};
const PAY_LABEL = { cod: 'Thanh toán khi nhận hàng', bank: 'Chuyển khoản' };

/* ------------------------------------------------------------------ cơ sở dữ liệu (JSON, ghi nguyên tử) */
function emptyDb() {
  return { version: 1, seq: { order: 0, product: 0, review: 0, chat: 0 }, products: [], orders: [], reviews: [], chats: [], staff: [] };
}
function loadDb() {
  let db;
  try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') {
      const bk = DB_FILE + '.corrupt-' + Date.now();
      try { fs.copyFileSync(DB_FILE, bk); console.error('! db.json lỗi, đã sao lưu ->', bk); } catch (_) { /* bỏ qua */ }
    }
    db = emptyDb();
  }
  for (const k of Object.keys(emptyDb())) if (db[k] === undefined) db[k] = emptyDb()[k];
  if (!db.products.length) {
    let seed = [];
    try { seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); } catch (_) { console.error('! Không đọc được data/seed-products.json'); }
    db.products = seed.map((p) => ({ id: ++db.seq.product, ...p }));
  }
  return db;
}
const db = loadDb();
let saveTimer = null, saving = false, dirty = false;
function writeNow() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
  dirty = false;
}
function save() {
  dirty = true;
  if (saveTimer || saving) return;
  saveTimer = setTimeout(() => {
    saveTimer = null; saving = true;
    try { writeNow(); } catch (e) { console.error('! Lỗi ghi db:', e.message); }
    saving = false;
  }, 120);
}
function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } if (dirty) { try { writeNow(); } catch (e) { console.error(e); } } }
save();

let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch (_) { SECRET = ''; }
if (SECRET.length < 32) { SECRET = crypto.randomBytes(48).toString('hex'); fs.writeFileSync(SECRET_FILE, SECRET, { mode: 0o600 }); }

/* ------------------------------------------------------------------ mật khẩu */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [, saltHex, hashHex] = String(stored).split('$');
    const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(h, Buffer.from(hashHex, 'hex'));
  } catch (_) { return false; }
}
const DUMMY_HASH = hashPassword('gewon-dummy-password');

/* ------------------------------------------------------------------ giới hạn tần suất (trong bộ nhớ) */
const buckets = new Map();
function hit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60e3).unref();
function limit(req, name, max, windowMs, msg) {
  if (!hit(name + ':' + req.ip, max, windowMs)) throw new HttpError(429, msg || 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.');
}

/* ------------------------------------------------------------------ phiên đăng nhập (cookie ký) */
const sessions = new Map();
const COOKIE = 'gw_sid';
const sign = (sid) => crypto.createHmac('sha256', SECRET).update(sid).digest('base64url');
function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return out;
}
function getSession(req) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (!raw) return null;
  const [sid, mac] = raw.split('.');
  if (!sid || !mac || !safeEq(sign(sid), mac)) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  const now = Date.now();
  if (now - s.last > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS) { sessions.delete(sid); return null; }
  s.last = now;
  return s;
}
function newSession(res, staff) {
  const sid = rid(24);
  const s = { sid, csrf: rid(24), staff: staff || null, created: Date.now(), last: Date.now() };
  sessions.set(sid, s);
  const parts = [`${COOKIE}=${sid}.${sign(sid)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict'];
  if (SECURE_COOKIE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
  return s;
}
function ensureSession(req, res) { return req.session || (req.session = getSession(req) || newSession(res)); }
function clearSession(req, res) {
  if (req.session) sessions.delete(req.session.sid);
  req.session = null;
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${SECURE_COOKIE ? '; Secure' : ''}`);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of sessions) if (now - s.last > SESSION_IDLE_MS || now - s.created > SESSION_MAX_MS) sessions.delete(k);
}, 10 * 60e3).unref();

const publicStaff = (a) => (a ? { username: a.username, name: a.name || a.username, role: a.role } : null);
const staffOf = (s) => (s && s.staff ? db.staff.find((a) => a.username === s.staff) || null : null);

/* ------------------------------------------------------------------ chuẩn hoá dữ liệu trả ra */
const pubProduct = (p) => ({
  id: p.id, key: p.key, name: p.name, brand: p.brand || '', price: p.price, stock: p.stock, category: p.category,
  tag: p.tag || '', description: p.description || '', imageUrl: p.imageUrl || '', sort: p.sort,
  inStock: p.stock == null || p.stock > 0,
});
const staffProduct = (p) => ({
  id: p.id, key: p.key, name: p.name, brand: p.brand || '', price: p.price, stock: p.stock, category: p.category,
  description: p.description || '', warranty: p.warranty || '', imageUrl: p.imageUrl || '',
  active: !!p.active, isSample: !!p.isSample,
});
function staffOrder(o) {
  const pay = PAY_LABEL[o.pay] || o.pay;
  const map = o.loc ? ` [Bản đồ: https://www.google.com/maps?q=${o.loc.lat},${o.loc.lng}]` : '';
  return {
    id: o.id, code: o.code, status: o.status, createdAt: o.createdAt, updatedAt: o.updatedAt,
    customerName: o.customerName, phone: o.phone, address: o.address + map,
    note: [pay, o.note].filter(Boolean).join(' | '), total: o.total, isSample: !!o.isSample,
    items: o.items.map((i) => ({ name: i.name + (i.size ? ' · Size ' + i.size : ''), quantity: i.quantity, unitPrice: i.unitPrice })),
  };
}
const staffChat = (c) => ({ id: c.id, contact: c.contact, status: c.status, note: c.note || '', createdAt: c.createdAt, updatedAt: c.updatedAt, messages: c.messages });

/* ------------------------------------------------------------------ nghiệp vụ */
function chatsByPhone(phone) {
  const d = digits(phone);
  return d ? db.chats.filter((c) => digits(c.contact) === d && c.status === 'open') : [];
}
function pushMsg(chat, from, text, name) {
  chat.messages.push({ from, name: name || undefined, text, at: sqlTime() });
  if (chat.messages.length > 500) chat.messages.splice(0, chat.messages.length - 500);
  chat.updatedAt = sqlTime();
}
function restoreStock(order) {
  order.items.forEach((i) => {
    const p = db.products.find((x) => x.key === i.productKey);
    if (p && p.stock != null) p.stock += i.quantity;
  });
}
function setOrderStatus(order, status) {
  if (!STATUS[status]) throw bad('Trạng thái không hợp lệ.');
  if (order.status === status) return;
  if (order.status === 'cancelled') throw bad('Đơn đã hủy không thể mở lại. Hãy nhờ khách đặt đơn mới.');
  if (status === 'cancelled') restoreStock(order);
  order.status = status;
  order.updatedAt = sqlTime();
  chatsByPhone(order.phone).forEach((c) => pushMsg(c, 'auto', `Đơn ${order.code}: ${STATUS[status]}.`));
}
function newOrderCode() {
  for (;;) {
    const c = 'GW' + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    if (!db.orders.some((o) => o.code === c)) return c;
  }
}
function validImage(u) {
  if (!u) return true;
  return u.length <= 1000 && (/^https?:\/\/[^\s"'<>\\]+$/i.test(u) || /^\/?images\/[A-Za-z0-9._\/-]+$/.test(u)) && !u.includes('..');
}
function readProductInput(b, existing) {
  const out = {};
  if (!existing || b.name !== undefined) {
    out.name = str(b.name, 120);
    if (out.name.length < 2) throw bad('Tên sản phẩm cần ít nhất 2 ký tự.');
  }
  if (!existing || b.price !== undefined) {
    const p = Number(String(b.price).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(p) || p < 0 || p > 1e9) throw bad('Giá không hợp lệ (0 – 1.000.000.000).');
    out.price = Math.round(p);
  }
  if (b.stock !== undefined) {
    if (b.stock === '' || b.stock === null) out.stock = null;
    else {
      const s = Number(b.stock);
      if (!Number.isInteger(s) || s < 0 || s > 1e6) throw bad('Tồn kho phải là số nguyên ≥ 0 (hoặc để trống nếu chưa xác nhận).');
      out.stock = s;
    }
  }
  if (b.brand !== undefined) out.brand = str(b.brand, 60);
  if (b.category !== undefined || !existing) {
    const c = str(b.category || 'tops', 20);
    if (!CATEGORIES[c]) throw bad('Danh mục không hợp lệ.');
    out.category = c;
  }
  if (b.description !== undefined) out.description = str(b.description, 1600);
  if (b.warranty !== undefined) out.warranty = str(b.warranty, 500);
  if (b.imageUrl !== undefined) {
    const u = str(b.imageUrl, 1000);
    if (!validImage(u)) throw bad('URL ảnh phải bắt đầu bằng https:// (hoặc images/…).');
    out.imageUrl = u;
  }
  if (b.active !== undefined) out.active = b.active === true || b.active === 'true';
  if (b.isSample !== undefined) out.isSample = b.isSample === true || b.isSample === 'true';
  return out;
}

/* ------------------------------------------------------------------ các route */
const routes = [];
const route = (method, pattern, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, opts, fn });
};
const staffOnly = { staff: true };
const adminOnly = { staff: true, admin: true };

/* ---- chung ---- */
route('GET', '/api/health', (req) => ({ ok: true, mode: 'server', time: sqlTime() }));
route('GET', '/api/session', (req, res) => {
  const s = ensureSession(req, res);
  return { csrfToken: s.csrf, staff: publicStaff(staffOf(s)) };
});
route('GET', '/api/boot.js', (req, res) => {
  const products = db.products.filter((p) => p.active).sort((a, b) => a.sort - b.sort).map(pubProduct);
  res.raw = { type: 'application/javascript; charset=utf-8', body: 'window.GW_BOOT=' + JSON.stringify({ rate: RATE, products }).replace(/</g, '\\u003c') + ';' };
});

/* ---- khách: sản phẩm ---- */
route('GET', '/api/products', () => ({
  products: db.products.filter((p) => p.active).sort((a, b) => a.sort - b.sort).map(pubProduct),
}));

/* ---- khách: đặt hàng ---- */
route('POST', '/api/orders', (req, res, b) => {
  limit(req, 'order', 10, 10 * 60e3, 'Bạn đặt hàng quá nhiều lần. Vui lòng thử lại sau ít phút hoặc nhắn Zalo cho shop.');
  const name = str(b.name, 60), address = str(b.address, 220), note = str(b.note, 200);
  const phone = digits(b.phone);
  if (name.length < 2) throw bad('Vui lòng nhập họ tên.');
  if (!/^0\d{9,10}$/.test(phone)) throw bad('Số điện thoại không hợp lệ.');
  if (address.length < 8) throw bad('Vui lòng nhập địa chỉ giao hàng.');
  const pay = b.pay === 'bank' ? 'bank' : 'cod';
  let loc = null;
  if (b.loc && Number.isFinite(+b.loc.lat) && Number.isFinite(+b.loc.lng) && Math.abs(+b.loc.lat) <= 90 && Math.abs(+b.loc.lng) <= 180) {
    loc = { lat: +(+b.loc.lat).toFixed(6), lng: +(+b.loc.lng).toFixed(6) };
  }
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) throw bad('Giỏ hàng trống hoặc quá lớn.');
  const need = new Map(); // productKey -> tổng số lượng
  const items = b.items.map((it) => {
    const p = db.products.find((x) => x.key === str(it.key, 160));
    if (!p || !p.active) throw bad('Có sản phẩm không còn bán: ' + str(it.name || it.key, 80));
    const sizes = SIZE_SETS[p.sizeSet || CATEGORIES[p.category] || 'a'];
    const size = str(it.size, 12);
    if (!sizes.includes(size)) throw bad(`Size "${size}" không hợp lệ cho ${p.name}.`);
    const q = Number(it.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 9) throw bad('Số lượng mỗi dòng phải từ 1 đến 9.');
    need.set(p.key, (need.get(p.key) || 0) + q);
    return { productKey: p.key, name: p.name, size, quantity: q, unitPrice: p.price };
  });
  for (const [k, q] of need) {
    const p = db.products.find((x) => x.key === k);
    if (p.stock != null && p.stock < q) throw new HttpError(409, p.stock === 0 ? `${p.name} đã hết hàng.` : `${p.name} chỉ còn ${p.stock} sản phẩm.`);
  }
  for (const [k, q] of need) { const p = db.products.find((x) => x.key === k); if (p.stock != null) p.stock -= q; }
  const now = sqlTime();
  const order = {
    id: ++db.seq.order, code: newOrderCode(), status: 'pending', createdAt: now, updatedAt: now,
    customerName: name, phone, address, note, pay, loc, items,
    total: items.reduce((s, i) => s + i.unitPrice * i.quantity, 0), isSample: false,
  };
  db.orders.push(order);
  chatsByPhone(phone).forEach((c) => pushMsg(c, 'auto', `Cửa hàng đã nhận đơn ${order.code}.`));
  save();
  return { order: { code: order.code, status: order.status, total: order.total, createdAt: order.createdAt } };
});
route('POST', '/api/orders/track', (req, res, b) => {
  limit(req, 'track', 60, 60e3);
  const list = Array.isArray(b.orders) ? b.orders.slice(0, 30) : [];
  const out = [];
  list.forEach((x) => {
    const o = db.orders.find((y) => y.code === str(x.code, 20));
    if (o && digits(x.phone) === o.phone) out.push({ code: o.code, status: o.status, updatedAt: o.updatedAt });
    else out.push({ code: str(x.code, 20), status: 'missing' });
  });
  return { orders: out };
});
route('POST', '/api/orders/:code/cancel', (req, res, b, p) => {
  limit(req, 'ocancel', 20, 10 * 60e3);
  const o = db.orders.find((y) => y.code === p.code);
  if (!o || digits(b.phone) !== o.phone) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
  if (o.status === 'cancelled') return { ok: true, status: o.status };
  if (!['pending', 'confirmed'].includes(o.status)) throw new HttpError(409, 'Đơn đã được chuẩn bị/giao nên không thể hủy online. Vui lòng nhắn Zalo cho shop.');
  setOrderStatus(o, 'cancelled');
  o.cancelledBy = 'customer';
  save();
  return { ok: true, status: o.status };
});

/* ---- khách: đánh giá ---- */
const reviewDate = (iso) => { const d = new Date(iso.replace(' ', 'T') + 'Z'); return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); };
route('GET', '/api/reviews', () => ({
  reviews: db.reviews.slice().reverse().slice(0, 200).map((r) => ({ id: r.id, name: r.name, productKey: r.productKey, rating: r.rating, text: r.text, createdAt: r.createdAt, dateLabel: reviewDate(r.createdAt) })),
}));
route('POST', '/api/reviews', (req, res, b) => {
  limit(req, 'review', 5, 30 * 60e3, 'Bạn gửi đánh giá quá nhiều lần, vui lòng thử lại sau.');
  const name = str(b.name, 40), text = str(b.text, 400), rating = Number(b.rating);
  const p = db.products.find((x) => x.key === str(b.productKey, 160));
  if (!name || !p || !Number.isInteger(rating) || rating < 1 || rating > 5 || text.length < 10) throw bad('Vui lòng nhập tên, chọn số sao và viết ít nhất 10 ký tự.');
  const r = { id: ++db.seq.review, name, productKey: p.key, rating, text, createdAt: sqlTime() };
  db.reviews.push(r);
  if (db.reviews.length > 2000) db.reviews.splice(0, db.reviews.length - 2000);
  save();
  return { review: { id: r.id, name, productKey: p.key, rating, text, dateLabel: reviewDate(r.createdAt) } };
});

/* ---- khách: chat với nhân viên ---- */
const chatView = (c) => ({ id: c.id, status: c.status, messages: c.messages });
function ownChat(id, token) {
  const c = db.chats.find((x) => x.id === Number(id));
  if (!c || !token || !safeEq(sha(token), c.tokenHash)) throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện.');
  return c;
}
route('POST', '/api/chat', (req, res, b) => {
  limit(req, 'chatnew', 6, 30 * 60e3);
  const contact = str(b.contact, 40), text = str(b.text, 1000) || 'Khách muốn được nhân viên liên hệ lại.';
  if (!/^0\d{9,10}$/.test(digits(b.contact))) throw bad('Vui lòng nhập số điện thoại / Zalo hợp lệ để nhân viên liên hệ lại.');
  const token = rid(24), now = sqlTime();
  const chat = { id: ++db.seq.chat, contact, status: 'open', note: str(b.note, 200) || (b.source === 'ngot' ? 'Từ chat AI Ngot' : ''), createdAt: now, updatedAt: now, tokenHash: sha(token), messages: [] };
  pushMsg(chat, 'customer', text);
  pushMsg(chat, 'auto', 'Cảm ơn bạn! Nhân viên sẽ trả lời ngay khi có thể (9:00–21:00 mỗi ngày).');
  db.chats.push(chat);
  save();
  return { id: chat.id, token, chat: chatView(chat) };
});
route('POST', '/api/chat/:id/messages', (req, res, b, p) => {
  limit(req, 'chatmsg', 30, 60e3);
  const chat = ownChat(p.id, b.token), text = str(b.text, 1000);
  if (!text) throw bad('Tin nhắn trống.');
  pushMsg(chat, 'customer', text);
  chat.status = 'open';
  save();
  return { chat: chatView(chat) };
});
route('GET', '/api/chat/:id/messages', (req, res, b, p, q) => {
  limit(req, 'chatpoll', 120, 60e3);
  return { chat: chatView(ownChat(p.id, q.get('token'))) };
});

/* ---- nhân viên: đăng nhập ---- */
function loginPayload(req, res, account) {
  if (req.session) sessions.delete(req.session.sid); // đổi phiên sau khi đăng nhập (chống session fixation)
  const s = newSession(res, account.username);
  req.session = s;
  return { csrfToken: s.csrf, staff: publicStaff(account) };
}
route('GET', '/api/staff/status', () => ({ needsSetup: db.staff.length === 0 }));
route('POST', '/api/staff/setup', (req, res, b) => {
  limit(req, 'setup', 10, 15 * 60e3);
  if (db.staff.length) throw new HttpError(403, 'Hệ thống đã được thiết lập. Hãy đăng nhập.');
  const username = str(b.username, 32).toLowerCase(), password = String(b.password || '');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw bad('Tên đăng nhập 3–32 ký tự: chữ thường, số, . _ -');
  if (password.length < 8 || password.length > 200) throw bad('Mật khẩu cần ít nhất 8 ký tự.');
  const acc = { username, name: str(b.name, 60) || username, role: 'admin', hash: hashPassword(password), createdAt: sqlTime() };
  db.staff.push(acc);
  save();
  return loginPayload(req, res, acc);
});
route('POST', '/api/staff/login', (req, res, b) => {
  const username = str(b.username, 32).toLowerCase(), password = String(b.password || '').slice(0, 200);
  const key = 'login:' + req.ip + ':' + username;
  const bk = buckets.get(key);
  if (bk && bk.reset > Date.now() && bk.n >= 5) throw new HttpError(429, 'Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.');
  const acc = db.staff.find((a) => a.username === username);
  const ok = verifyPassword(password, acc ? acc.hash : DUMMY_HASH) && !!acc;
  if (!ok) { hit(key, 5, 15 * 60e3); throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu.'); }
  buckets.delete(key);
  return loginPayload(req, res, acc);
});
route('POST', '/api/staff/logout', staffOnly, (req, res) => { clearSession(req, res); return { ok: true }; });

/* ---- nhân viên: đơn hàng ---- */
route('GET', '/api/staff/orders', staffOnly, () => ({
  orders: db.orders.slice().sort((a, b) => b.id - a.id).slice(0, 1000).map(staffOrder),
}));
route('PATCH', '/api/staff/orders/:id/status', staffOnly, (req, res, b, p) => {
  const o = db.orders.find((x) => x.id === Number(p.id));
  if (!o) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
  setOrderStatus(o, str(b.status, 20));
  save();
  return { ok: true, order: staffOrder(o) };
});
route('DELETE', '/api/staff/orders/:id', staffOnly, (req, res, b, p) => {
  const i = db.orders.findIndex((x) => x.id === Number(p.id));
  if (i < 0) throw new HttpError(404, 'Không tìm thấy đơn hàng.');
  if (!['delivered', 'cancelled'].includes(db.orders[i].status)) throw bad('Chỉ xóa được đơn đã giao hoặc đã hủy.');
  db.orders.splice(i, 1);
  save();
  return { ok: true };
});
route('DELETE', '/api/staff/orders', staffOnly, () => {
  const before = db.orders.length;
  db.orders = db.orders.filter((o) => !['delivered', 'cancelled'].includes(o.status));
  save();
  return { removed: before - db.orders.length };
});

/* ---- nhân viên: chat khách ---- */
route('GET', '/api/staff/handoffs', staffOnly, () => ({
  handoffs: db.chats.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(staffChat),
}));
route('PATCH', '/api/staff/handoffs/:id', staffOnly, (req, res, b, p) => {
  const c = db.chats.find((x) => x.id === Number(p.id));
  if (!c) throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện.');
  if (!['open', 'done'].includes(b.status)) throw bad('Trạng thái không hợp lệ.');
  c.status = b.status; c.updatedAt = sqlTime();
  save();
  return { ok: true };
});
route('POST', '/api/staff/handoffs/:id/reply', staffOnly, (req, res, b, p) => {
  const c = db.chats.find((x) => x.id === Number(p.id));
  if (!c) throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện.');
  const text = str(b.text, 1000);
  if (!text) throw bad('Tin nhắn trống.');
  const a = staffOf(req.session);
  const lm = c.messages[c.messages.length - 1];
  if (lm && lm.from === 'staff' && lm.text === text && Date.now() - Date.parse(lm.at.replace(' ', 'T') + 'Z') < 5000) return { ok: true, duplicate: true };
  pushMsg(c, 'staff', text, a.name || a.username);
  c.status = 'open';
  save();
  return { ok: true };
});
route('DELETE', '/api/staff/handoffs/:id', staffOnly, (req, res, b, p) => {
  const i = db.chats.findIndex((x) => x.id === Number(p.id));
  if (i < 0) throw new HttpError(404, 'Không tìm thấy cuộc trò chuyện.');
  db.chats.splice(i, 1);
  save();
  return { ok: true };
});
route('DELETE', '/api/staff/handoffs', staffOnly, () => {
  const before = db.chats.length;
  db.chats = db.chats.filter((c) => c.status !== 'done');
  save();
  return { removed: before - db.chats.length };
});

/* ---- nhân viên: sản phẩm ---- */
route('GET', '/api/staff/products', staffOnly, () => ({ products: db.products.slice().sort((a, b) => a.sort - b.sort).map(staffProduct) }));
route('POST', '/api/staff/products', staffOnly, (req, res, b) => {
  const f = readProductInput(b, null);
  let key = slug(f.name), n = 2;
  while (db.products.some((p) => p.key === key)) key = slug(f.name) + '-' + n++;
  const prod = {
    id: ++db.seq.product, key, name: f.name, brand: f.brand || 'Gewon', price: f.price, stock: f.stock === undefined ? null : f.stock,
    category: f.category, sizeSet: CATEGORIES[f.category], tag: 'New', colors: ['#111'], images: [],
    description: f.description || '', warranty: f.warranty || '', imageUrl: f.imageUrl || '', active: true, isSample: false,
    sort: db.products.reduce((m, p) => Math.max(m, p.sort), -1) + 1,
  };
  db.products.push(prod);
  save();
  return { product: staffProduct(prod) };
});
route('PATCH', '/api/staff/products/:id', staffOnly, (req, res, b, p) => {
  const prod = db.products.find((x) => x.id === Number(p.id));
  if (!prod) throw new HttpError(404, 'Không tìm thấy sản phẩm.');
  const f = readProductInput(b, prod);
  Object.assign(prod, f);
  if (f.category) prod.sizeSet = CATEGORIES[f.category];
  save();
  return { product: staffProduct(prod) };
});

/* ---- nhân viên: tài khoản (chỉ quản lý) ---- */
route('GET', '/api/staff/accounts', adminOnly, () => ({ accounts: db.staff.map(publicStaff) }));
route('POST', '/api/staff/accounts', adminOnly, (req, res, b) => {
  const username = str(b.username, 32).toLowerCase(), password = String(b.password || '');
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw bad('Tên đăng nhập 3–32 ký tự: chữ thường, số, . _ -');
  if (password.length < 8 || password.length > 200) throw bad('Mật khẩu cần ít nhất 8 ký tự.');
  if (db.staff.some((a) => a.username === username)) throw bad('Tên đăng nhập đã tồn tại.');
  const role = b.role === 'admin' ? 'admin' : 'staff';
  db.staff.push({ username, name: str(b.name, 60) || username, role, hash: hashPassword(password), createdAt: sqlTime() });
  save();
  return { message: `Đã tạo tài khoản ${username} (${role === 'admin' ? 'Quản lý' : 'Nhân viên'}).` };
});
route('DELETE', '/api/staff/accounts', adminOnly, (req, res, b) => {
  const username = str(b.username, 32).toLowerCase();
  const i = db.staff.findIndex((a) => a.username === username);
  if (i < 0) throw new HttpError(404, 'Không tìm thấy tài khoản.');
  if (username === req.session.staff) throw bad('Bạn không thể xóa chính tài khoản đang đăng nhập.');
  if (db.staff[i].role === 'admin' && db.staff.filter((a) => a.role === 'admin').length < 2) throw bad('Phải giữ lại ít nhất một tài khoản Quản lý.');
  db.staff.splice(i, 1);
  for (const [k, s] of sessions) if (s.staff === username) sessions.delete(k);
  save();
  return { ok: true };
});

/* ------------------------------------------------------------------ file tĩnh */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);
const fileCache = new Map();
const PAGE_ALIAS = { '/': '/index.html', '/staff': '/staff.html', '/admin': '/staff.html' };

function serveStatic(req, res, pathname) {
  pathname = PAGE_ALIAS[pathname] || pathname;
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (_) { return send(res, 400, 'Bad request'); }
  if (rel.includes('\0') || rel.split('/').some((s) => s.startsWith('.'))) return send(res, 404, 'Not found');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
  let st;
  try { st = fs.statSync(file); } catch (_) { return send(res, 404, 'Không tìm thấy trang.'); }
  if (!st.isFile()) return send(res, 404, 'Not found');
  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) return send(res, 404, 'Not found');
  let c = fileCache.get(file);
  if (!c || c.mtime !== st.mtimeMs || c.size !== st.size) {
    const buf = fs.readFileSync(file);
    c = { mtime: st.mtimeMs, size: st.size, buf, gz: COMPRESSIBLE.has(ext) && buf.length > 1024 ? zlib.gzipSync(buf, { level: 6 }) : null,
      etag: '"' + crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 20) + '"' };
    fileCache.set(file, c);
  }
  const isMedia = /^\.(mp3|ogg|m4a|wav)$/.test(ext);
  const longCache = isMedia || pathname.startsWith('/img/');
  const headers = { 'Content-Type': MIME[ext], ETag: c.etag, 'Cache-Control': longCache ? 'public, max-age=604800' : (ext === '.html' || ext === '.js' ? 'no-cache' : 'public, max-age=86400'), Vary: 'Accept-Encoding', 'Accept-Ranges': 'bytes' };
  if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, headers); return res.end(); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (isMedia || ext === '.mp4')) {
    let a = range[1] === '' ? NaN : Number(range[1]), b = range[2] === '' ? NaN : Number(range[2]);
    if (Number.isNaN(a) && !Number.isNaN(b)) { a = Math.max(0, c.buf.length - b); b = c.buf.length - 1; }
    if (Number.isNaN(b) || b >= c.buf.length) b = c.buf.length - 1;
    if (Number.isNaN(a) || a > b) { res.writeHead(416, { 'Content-Range': 'bytes */' + c.buf.length }); return res.end(); }
    headers['Content-Range'] = `bytes ${a}-${b}/${c.buf.length}`;
    headers['Content-Length'] = b - a + 1;
    res.writeHead(206, headers);
    return res.end(req.method === 'HEAD' ? undefined : c.buf.subarray(a, b + 1));
  }
  const useGz = c.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = useGz ? c.gz : c.buf;
  if (useGz) headers['Content-Encoding'] = 'gzip';
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function send(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(text);
}

/* ------------------------------------------------------------------ xử lý yêu cầu */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > MAX_BODY) { reject(new HttpError(413, 'Dữ liệu gửi lên quá lớn.')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => {
      if (!n) return resolve({});
      try { const j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); }
      catch (_) { reject(bad('Dữ liệu JSON không hợp lệ.')); }
    });
    req.on('error', reject);
  });
}
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function clientIp(req) {
  if (TRUST_PROXY) { const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); if (f) return f; }
  return req.socket.remoteAddress || '?';
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const match = routes.find((r) => r.method === req.method && r.re.test(pathname));
  if (!match) {
    if (routes.some((r) => r.re.test(pathname))) throw new HttpError(405, 'Phương thức không được hỗ trợ.');
    throw new HttpError(404, 'Không tìm thấy API.');
  }
  const mutating = req.method !== 'GET' && req.method !== 'HEAD';
  if (mutating) {
    const origin = req.headers.origin;
    if (origin) { let h = ''; try { h = new URL(origin).host; } catch (_) { /* origin lạ */ } const fwd = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim(); if (h !== req.headers.host && h !== fwd) throw new HttpError(403, 'Yêu cầu bị từ chối (sai nguồn gốc).'); }
    const ct = String(req.headers['content-type'] || '');
    if (req.headers['content-length'] !== '0' && req.headers['content-length'] !== undefined && !ct.includes('application/json')) throw new HttpError(415, 'Cần gửi dữ liệu dạng JSON.');
  }
  const body = mutating ? await readBody(req) : {};
  const params = {};
  const m = match.re.exec(pathname);
  match.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  req.session = getSession(req);
  if (match.opts.staff) {
    const acc = staffOf(req.session);
    if (!acc) throw new HttpError(401, 'Chưa đăng nhập hoặc phiên đã hết hạn.');
    if (mutating && !(req.session.csrf && safeEq(req.headers['x-csrf-token'] || '', req.session.csrf))) throw new HttpError(403, 'Phiên không hợp lệ (CSRF). Hãy tải lại trang.');
    if (match.opts.admin && acc.role !== 'admin') throw new HttpError(403, 'Chỉ Quản lý mới dùng được chức năng này.');
  }
  const out = match.fn(req, res, body, params, url.searchParams);
  if (res.raw) { res.writeHead(200, { 'Content-Type': res.raw.type, 'Cache-Control': 'no-store' }); return res.end(res.raw.body); }
  json(res, 200, out === undefined ? { ok: true } : out);
}

const server = http.createServer(async (req, res) => {
  req.ip = clientIp(req);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  try {
    const url = new URL(req.url, 'http://localhost');
    const isStaffPage = ['/staff', '/staff.html', '/admin'].includes(url.pathname);
    if (isStaffPage) {
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    } else res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (url.pathname.startsWith('/api/')) {
      try { await handleApi(req, res, url); }
      catch (e) {
        if (res.headersSent) return res.destroy();
        const status = e instanceof HttpError ? e.status : 500;
        if (status === 500) console.error('! Lỗi API', req.method, url.pathname, e);
        json(res, status, { error: status === 500 ? 'Lỗi máy chủ, vui lòng thử lại.' : e.message });
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error('! Lỗi:', e);
    if (!res.headersSent) send(res, 500, 'Lỗi máy chủ.');
  }
});
server.requestTimeout = 30e3;
server.headersTimeout = 15e3;
server.keepAliveTimeout = 5e3;

/* tạo sẵn tài khoản quản lý đầu tiên nếu khai báo trong biến môi trường */
if (!db.staff.length && process.env.ADMIN_USER && process.env.ADMIN_PASS) {
  if (process.env.ADMIN_PASS.length >= 8) {
    db.staff.push({ username: process.env.ADMIN_USER.toLowerCase(), name: process.env.ADMIN_NAME || process.env.ADMIN_USER, role: 'admin', hash: hashPassword(process.env.ADMIN_PASS), createdAt: sqlTime() });
    save();
    console.log('✓ Đã tạo tài khoản quản lý từ ADMIN_USER / ADMIN_PASS.');
  } else console.error('! ADMIN_PASS cần ít nhất 8 ký tự — bỏ qua.');
}

function lanUrls() {
  try { return Object.values(require('node:os').networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}/`); } catch (_) { return []; }
}
server.listen(PORT, HOST, () => {
  if (HOST === '0.0.0.0') lanUrls().forEach((u) => console.log('  Điện thoại (cùng Wi-Fi): ' + u));
  console.log(`\nGEWON đang chạy\n  Cửa hàng:    http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/\n  Nhân viên:   http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/staff\n  Dữ liệu:     ${DB_FILE}\n`);
  if (!db.staff.length) console.log('  → Mở /staff lần đầu để tạo tài khoản Quản lý.\n');
});
function shutdown() { console.log('\nĐang lưu dữ liệu và tắt…'); flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', flush);
