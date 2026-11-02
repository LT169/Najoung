'use strict';
/* Đặt lại mật khẩu nhân viên:
 *   node scripts/reset-password.js <tên-đăng-nhập> <mật-khẩu-mới>
 * Nên TẮT server trước khi chạy (server giữ dữ liệu trong bộ nhớ và sẽ ghi đè). */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const [user, pass] = [String(process.argv[2] || '').toLowerCase(), process.argv[3] || ''];
if (!user || pass.length < 8) { console.error('Cách dùng: node scripts/reset-password.js <tên-đăng-nhập> <mật-khẩu-mới (>= 8 ký tự)>'); process.exit(1); }
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { console.error('Không đọc được', DB_FILE); process.exit(1); }
const acc = (db.staff || []).find((a) => a.username === user);
if (!acc) { console.error('Không có tài khoản', user, '— hiện có:', (db.staff || []).map((a) => a.username).join(', ') || '(trống)'); process.exit(1); }
const salt = crypto.randomBytes(16);
const h = crypto.scryptSync(pass, salt, 64, { N: 16384, r: 8, p: 1 });
acc.hash = 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex');
fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
fs.renameSync(DB_FILE + '.tmp', DB_FILE);
console.log('✓ Đã đổi mật khẩu cho', user);
