/* GEWON — "Gặp nhân viên" nằm NGAY TRONG khung chat AI (Ngot).
   Khách bấm "👤 Gặp nhân viên" → chỉ cần để lại số điện thoại → bấm Gửi → hiện ở trang /staff (tab "Tin nhắn khách").
   Khi nhân viên trả lời, tin nhắn hiện lại ngay trong khung chat này. */
(function () {
  'use strict';
  var KEY = 'gw_staffchat', SEEN = 'gw_staffseen';
  var panel = document.getElementById('ngot-panel');
  var msgs = document.getElementById('ngot-messages');
  var launch = document.getElementById('ngot-launch');
  var tools = panel && panel.querySelector('.ng-tools');
  var form = document.getElementById('ngot-form');
  var input = document.getElementById('ngot-input');
  if (!panel || !msgs || !tools || !form) return;

  /* gọi API riêng, không phụ thuộc gewon-api.js (nút vẫn hiện dù file kia chưa nạp được) */
  function call(url, method, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .catch(function () { var e = new Error('Không kết nối được tới cửa hàng.'); e.network = true; throw e; })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (!res.ok) { var e = new Error(d.error || 'Yêu cầu thất bại (' + res.status + ').'); e.status = res.status; if (res.status >= 502 && res.status <= 504) e.network = true; throw e; }
          return d;
        });
      });
  }
  var GWL = {
    chatStart: function (b) { return call('/api/chat', 'POST', b); },
    chatSend: function (id, token, text) { return call('/api/chat/' + encodeURIComponent(id) + '/messages', 'POST', { token: token, text: text }); },
    chatGet: function (id, token) { return call('/api/chat/' + encodeURIComponent(id) + '/messages?token=' + encodeURIComponent(token)); },
  };

  var en = function () { try { return localStorage.getItem('gw_lang') === 'en'; } catch (_) { return false; } };
  var T = function (vi, e) { return en() ? e : vi; };
  var chat = null;
  try { chat = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
  var seen = 0;
  try { seen = parseInt(localStorage.getItem(SEEN) || '0', 10) || 0; } catch (_) {}
  var sound = function (n) { if (window.GWSound) window.GWSound.play(n); };
  var phoneOk = function (v) { return /^(\+?84|0)\d{9,10}$/.test(String(v).replace(/[\s.\-]/g, '')); };

  /* ---------- giao diện ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#gwh-chip{background:#171717!important;color:#fff!important;border-color:#171717!important;font-weight:700!important}' +
    '.gwh-card{background:#fff;border:1px solid #e8e4dc;border-radius:14px;padding:13px;color:#222;font-size:13px;line-height:1.45}' +
    '.gwh-card h4{margin:0 0 4px;font:700 13px "Inter Tight",Arial,sans-serif;color:#111}' +
    '.gwh-card p{margin:0 0 10px;color:#555;font-size:12px}' +
    '.gwh-card form{display:flex;flex-direction:column;gap:8px;margin:0}' +
    '.gwh-card input{width:100%;box-sizing:border-box;border:1px solid #cfcac1;border-radius:11px;padding:12px;font:16px "Inter Tight",Arial,sans-serif;color:#171717;background:#fff;outline:none}' +
    '.gwh-card input:focus{border-color:#111}' +
    '.gwh-card button{border:0;border-radius:11px;background:#111;color:#fff;min-height:44px;font:700 14px "Inter Tight",Arial,sans-serif;cursor:pointer}' +
    '.gwh-card button:disabled{opacity:.6}' +
    '.gwh-err{color:#b3261e;font-size:12px;min-height:15px}' +
    '.gwh-ok{display:flex;gap:8px;align-items:flex-start}.gwh-ok b{color:#111}' +
    '.gwh-staff small{display:block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#0a7a4b;margin-bottom:2px}' +
    '#gwh-dot{position:absolute;top:-2px;right:-2px;width:14px;height:14px;border-radius:50%;background:#e5322d;border:2px solid #fff;display:none}';
  document.head.appendChild(css);

  var chip = document.createElement('button');
  chip.type = 'button'; chip.id = 'gwh-chip';
  tools.insertBefore(chip, tools.children[1] || null);
  function paintChip() { chip.textContent = '👤 ' + T('Gặp nhân viên', 'Talk to staff'); }
  paintChip();
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-nglang]')) setTimeout(paintChip, 0); });

  var dot = document.createElement('span');
  dot.id = 'gwh-dot';
  if (launch) { launch.style.position = launch.style.position || 'relative'; launch.appendChild(dot); }

  function scrollDown() { msgs.scrollTop = msgs.scrollHeight; }
  function bubble(text, who, label) {
    var l = document.createElement('div'); l.className = 'ng-line ' + who;
    var ic = document.createElement('span'); ic.className = 'ng-line-icon'; ic.setAttribute('aria-hidden', 'true');
    ic.textContent = who === 'user' ? '🛍️' : (label ? '👤' : '🌹');
    var d = document.createElement('div'); d.className = 'ng-msg ' + who + (label ? ' gwh-staff' : '');
    if (label) { var s = document.createElement('small'); s.textContent = label; d.appendChild(s); }
    d.appendChild(document.createTextNode(text));
    l.appendChild(ic); l.appendChild(d); msgs.appendChild(l); scrollDown();
    return d;
  }
  function richWrap(node) {
    var r = document.createElement('div'); r.className = 'ng-rich'; r.appendChild(node); msgs.appendChild(r); scrollDown(); return r;
  }

  /* ---------- thẻ để lại số điện thoại ---------- */
  var activeCard = null;
  function recent() {
    var out = [];
    msgs.querySelectorAll('.ng-line.user .ng-msg').forEach(function (n) { out.push(n.textContent.trim()); });
    return out.slice(-3).filter(Boolean);
  }
  function showCard() {
    open();
    if (activeCard && activeCard.isConnected) { scrollDown(); var i0 = activeCard.querySelector('input'); if (i0) i0.focus(); return; }
    var hasChat = !!chat;
    var saved = '';
    try { saved = (JSON.parse(localStorage.getItem('gw_cust') || '{}').phone) || ''; } catch (_) {}
    var card = document.createElement('div'); card.className = 'gwh-card';
    card.innerHTML =
      '<h4></h4><p></p><form novalidate><input type="tel" inputmode="tel" autocomplete="tel" maxlength="20"><div class="gwh-err" role="alert"></div><button type="submit"></button></form>';
    card.querySelector('h4').textContent = hasChat ? T('Nhắn lại nhân viên', 'Ping staff again') : T('Gặp nhân viên GEWON', 'Talk to GEWON staff');
    card.querySelector('p').textContent = T('Để lại số điện thoại / Zalo, nhân viên sẽ liên hệ lại bạn (9:00–21:00 mỗi ngày).', 'Leave your phone / Zalo number and staff will get back to you (9:00–21:00 daily).');
    var ip = card.querySelector('input'); ip.placeholder = T('Số điện thoại / Zalo', 'Phone / Zalo number'); ip.value = saved;
    var btn = card.querySelector('button'); btn.textContent = T('Gửi cho nhân viên', 'Send to staff');
    var err = card.querySelector('.gwh-err');
    card.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault(); e.stopPropagation();
      var phone = ip.value.trim();
      if (!phoneOk(phone)) { err.textContent = T('Số điện thoại chưa hợp lệ, ví dụ 0385 730 766.', 'Please enter a valid phone number, e.g. 0385 730 766.'); ip.focus(); return; }
      err.textContent = ''; btn.disabled = true; btn.textContent = T('Đang gửi…', 'Sending…');
      var ctxLines = recent();
      var text = T('Khách muốn gặp nhân viên (gửi từ chat AI Ngot).', 'Customer wants to talk to staff (sent from the Ngot AI chat).') +
        (ctxLines.length ? '\n' + T('Khách vừa hỏi: ', 'Recent questions: ') + ctxLines.join(' | ') : '');
      send(phone, text).then(function () {
        try { var c = JSON.parse(localStorage.getItem('gw_cust') || '{}'); c.phone = c.phone || phone; localStorage.setItem('gw_cust', JSON.stringify(c)); } catch (_) {}
        sound('ok');
        card.parentNode && card.parentNode.remove();
        activeCard = null;
        bubble(T('Mình để lại số ' + phone + ', nhờ nhân viên liên hệ.', 'My number is ' + phone + ' — please contact me.'), 'user');
        bubble(T('Dạ, em đã chuyển số ' + phone + ' cho nhân viên rồi ạ. Nhân viên sẽ liên hệ sớm trong giờ làm việc (9:00–21:00). Nếu nhân viên trả lời, tin nhắn sẽ hiện ngay tại đây nhé.',
                 'Done — I passed ' + phone + ' to our staff. They will contact you soon (9:00–21:00). Their reply will appear right here.'), 'bot');
        schedulePoll();
      }).catch(function (er) {
        btn.disabled = false; btn.textContent = T('Gửi cho nhân viên', 'Send to staff');
        err.textContent = er.network ? T('Không kết nối được, vui lòng thử lại.', 'Could not connect, please try again.') : er.message;
      });
    });
    activeCard = richWrap(card);
    setTimeout(function () { try { ip.focus({ preventScroll: true }); } catch (_) {} scrollDown(); }, 150);
  }

  /* gửi: nếu đã có hội thoại thì nối tiếp, không thì tạo mới */
  function send(phone, text) {
    function start() {
      return GWL.chatStart({ contact: phone, text: text, source: 'ngot' }).then(function (r) {
        chat = { id: r.id, token: r.token };
        try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch (_) {}
        seen = (r.chat.messages || []).length; try { localStorage.setItem(SEEN, String(seen)); } catch (_) {}
        return r;
      });
    }
    if (!chat) return start();
    return GWL.chatSend(chat.id, chat.token, text).then(function (r) {
      seen = (r.chat.messages || []).length; try { localStorage.setItem(SEEN, String(seen)); } catch (_) {}
      return r;
    }).catch(function (er) { if (er.status === 404) { chat = null; try { localStorage.removeItem(KEY); } catch (_) {} return start(); } throw er; });
  }

  /* ---------- nhận trả lời của nhân viên ---------- */
  function open() { if (!panel.classList.contains('open') && launch) launch.click(); }
  function pull() {
    if (!chat || document.hidden) return;
    GWL.chatGet(chat.id, chat.token).then(function (r) {
      var list = (r.chat && r.chat.messages) || [];
      if (list.length < seen) seen = 0;
      var fresh = list.slice(seen);
      seen = list.length; try { localStorage.setItem(SEEN, String(seen)); } catch (_) {}
      var got = false;
      fresh.forEach(function (m) {
        if (m.from === 'staff') { bubble(m.text, 'bot', m.name || T('Nhân viên', 'Staff')); got = true; }
      });
      if (got) { sound('ding'); if (!panel.classList.contains('open')) dot.style.display = 'block'; }
    }).catch(function (e) { if (e && e.status === 404) { chat = null; try { localStorage.removeItem(KEY); } catch (_) {} } });
  }
  var timer = null;
  function schedulePoll() { if (!timer) timer = setInterval(pull, 4000); }
  if (chat) { schedulePoll(); pull(); }
  new MutationObserver(function () { if (panel.classList.contains('open')) dot.style.display = 'none'; })
    .observe(panel, { attributes: true, attributeFilter: ['class'] });

  /* ---------- kích hoạt ---------- */
  chip.addEventListener('click', function () { showCard(); });

  /* khách gõ "gặp nhân viên / tư vấn viên / người thật…" cũng mở thẻ này thay vì để AI đoán */
  var WANT = /(gap|noi chuyen|lien he|chat voi|nhan voi|can|muon|goi)\s+(nhan vien|tu van vien|nguoi that|admin|shop)|nhan vien|tu van vien|nguoi that|staff|human|real person|live agent|customer service/;
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); }
  panel.addEventListener('submit', function (e) {
    if (e.target !== form) return;
    var v = input.value.trim();
    if (!v || !WANT.test(norm(v))) return;
    e.preventDefault(); e.stopPropagation();
    input.value = '';
    bubble(v, 'user');
    showCard();
  }, true);
  /* nút Zalo/Enter đã có sẵn ở các câu trả lời của AI nên không đụng tới */
})();
