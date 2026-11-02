# Gewon — cửa hàng + khu vực nhân viên

Chạy bằng Node.js (>= 18), không cần cài thư viện.

    npm start            # http://localhost:3000   (nhân viên: /staff)

## Cấu trúc
    server.js                  máy chủ (API + phục vụ file trong public/)
    public/                    index.html, staff.html, gewon-api.js, gewon-chat.js
    data/seed-products.json    danh sách sản phẩm ban đầu (BẮT BUỘC)
    scripts/reset-password.js  đặt lại mật khẩu nhân viên
    render.yaml                cấu hình Render (tùy chọn)

## Đưa lên Render
1. Đẩy TOÀN BỘ thư mục này lên GitHub (giữ nguyên cấu trúc, đừng đưa file ra ngoài public/).
2. Render -> New -> Web Service -> chọn repo.
   - Build Command: npm install
   - Start Command: node server.js
   - Health Check Path: /api/health
3. Environment: ADMIN_USER, ADMIN_PASS (>= 8 ký tự). HOST, NODE_ENV, TRUST_PROXY không cần đặt, server tự nhận ra Render.
4. Mở https://<tên-app>.onrender.com/staff để đăng nhập.

## Lưu ý dữ liệu
Dữ liệu (đơn hàng, chat, tài khoản) nằm trong data/db.json. Gói miễn phí của Render xóa ổ đĩa mỗi lần deploy/khởi động lại.
Muốn giữ lâu dài: gắn Persistent Disk (gói trả phí), mount ví dụ ở /var/data, rồi đặt biến DATA_DIR=/var/data.

## Biến môi trường
PORT, HOST, DATA_DIR, NODE_ENV, TRUST_PROXY (0/1), COOKIE_SECURE (1), ADMIN_USER, ADMIN_PASS, ADMIN_NAME
