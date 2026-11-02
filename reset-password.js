'use strict';
// Dùng khi quên mật khẩu:  node scripts/reset-password.js <tên_đăng_nhập> <mật_khẩu_mới>
// Hãy TẮT server trước khi chạy (nếu không server sẽ ghi đè lại db.json).
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const file = path.join(__dirname, '..', 'data', 'db.json');
const [user, pass] = process.argv.slice(2);
if (!user || !pass || pass.length < 8) { console.error('Cú pháp: node scripts/reset-password.js <username> <mật khẩu ≥ 8 ký tự>'); process.exit(1); }
let db;
try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('Chưa có data/db.json — hãy chạy server và tạo tài khoản trước.'); process.exit(1); }
const a = db.staff.find((x) => x.username === user.toLowerCase());
if (!a) { console.error('Không có tài khoản "' + user + '". Hiện có: ' + db.staff.map((x) => x.username).join(', ')); process.exit(1); }
const salt = crypto.randomBytes(16);
a.hash = 'scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(pass, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file);
console.log('✓ Đã đặt lại mật khẩu cho', a.username);
