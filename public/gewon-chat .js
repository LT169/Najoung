/* GEWON — "Gặp nhân viên" nằm NGAY TRONG khung chat AI (Ngot).
   Khách bấm "👤 Gặp nhân viên" → nhập số điện thoại / Zalo → bấm Kết nối → hiện ở trang /staff (tab "Tin nhắn khách").
   Sau khi kết nối, khách nhắn thẳng vào ô chat; nhân viên trả lời hiện lại ngay trong khung chat này. */
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
    '.gwh-card button.gwh-back{margin-top:2px;min-height:38px;background:#fff;color:#111;border:1px solid #ddd8cf;font-weight:600;font-size:12.5px}' +
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
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-nglang]')) { setTimeout(paintChip, 0); setTimeout(function () { if (staffMode) setPh(); }, 30); } });

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
  var queue = [];
  function say(text, who, label) {
    if (panel.classList.contains('open')) bubble(text, who, label);
    else queue.push([text, who, label]);
  }
  function flush() { while (queue.length) { var q = queue.shift(); bubble(q[0], q[1], q[2]); } }
  function richWrap(node) {
    var r = document.createElement('div'); r.className = 'ng-rich'; r.appendChild(node); msgs.appendChild(r); scrollDown(); return r;
  }

  /* ---------- Gặp nhân viên: nhập số điện thoại để kết nối, sau đó chat trực tiếp ---------- */
  var activeCard = null, staffMode = false, qp = Promise.resolve();
  var coarse = function () { try { return matchMedia('(pointer:coarse)').matches; } catch (_) { return false; } };
  function focusInput() { if (!coarse()) { try { input.focus({ preventScroll: true }); } catch (_) {} } }
  function recent() {
    var out = [];
    msgs.querySelectorAll('.ng-line.user .ng-msg').forEach(function (n) { out.push(n.textContent.trim()); });
    return out.slice(-3).filter(Boolean);
  }
  function setPh() { if (staffMode) input.placeholder = T('Nhắn cho nhân viên…', 'Message our staff…'); }
  function enterStaff() { staffMode = true; setPh(); }
  function exitStaff() {
    staffMode = false;
    input.placeholder = T('Nhắn Ngot để được tư vấn…', 'Message Ngot for advice…');
    if (activeCard && activeCard.isConnected) activeCard.remove();
    activeCard = null;
  }
  function ctxText(lines) {
    return T('Khách muốn gặp nhân viên (gửi từ chat AI Ngot).', 'Customer wants to talk to staff (sent from the Ngot AI chat).') +
      (lines && lines.length ? '\n' + T('Khách vừa hỏi: ', 'Recent questions: ') + lines.join(' | ') : '');
  }
  /* nhắn tiếp cho nhân viên khi đã kết nối (gửi lần lượt, không tạo 2 cuộc hội thoại) */
  function toStaff(v) {
    bubble(v, 'user');
    var p = qp.then(function () { return send(null, v); });
    qp = p.catch(function () {});
    p.then(function () { schedulePoll(); }).catch(function (er) {
      if (!chat) {   /* hội thoại cũ đã hết hạn → xin lại số điện thoại */
        exitStaff();
        bubble(T('Dạ, phiên chat cũ đã hết hạn rồi ạ. Anh/chị để lại số điện thoại để em kết nối lại với nhân viên nhé.', 'The previous chat has expired. Please leave your phone number and I will reconnect you with our staff.'), 'bot');
        showCard();
        return;
      }
      bubble(er && er.network ? T('Dạ, chưa kết nối được với nhân viên. Anh/chị thử nhắn lại giúp em nhé ạ.', 'Could not reach our staff. Please try again.')
                              : T('Dạ, chưa gửi được tin nhắn. Anh/chị thử nhắn lại giúp em nhé ạ.', 'The message could not be sent. Please try again.'), 'bot');
      input.value = v;
    });
  }
  function backToAI() {
    exitStaff();
    bubble(T('Dạ, em quay lại hỗ trợ anh/chị ạ. Anh/chị cứ nhắn nhu cầu nhé.', 'I’m back to help. What are you looking for?'), 'bot');
  }
  function showCard() {
    open();
    if (activeCard && activeCard.isConnected) {
      scrollDown();
      var i0 = activeCard.querySelector('input'); if (i0) { try { i0.focus({ preventScroll: true }); } catch (_) {} } else focusInput();
      return;
    }
    var card = document.createElement('div'); card.className = 'gwh-card';

    if (chat) {
      /* đã có số điện thoại từ trước: không hỏi lại, chat tiếp luôn */
      enterStaff();
      card.innerHTML = '<h4></h4><p></p><button type="button" class="gwh-back"></button>';
      card.querySelector('h4').textContent = T('Tiếp tục chat với nhân viên', 'Back to chatting with staff');
      card.querySelector('p').textContent = T('Anh/chị cứ nhắn vào ô bên dưới, nhân viên sẽ trả lời ngay tại khung chat này (9:00–21:00 mỗi ngày).',
                                              'Just type in the box below; our staff will reply right here (9:00–21:00 daily).');
      var back0 = card.querySelector('.gwh-back'); back0.textContent = T('← Quay lại trợ lý AI', '← Back to the AI assistant');
      back0.addEventListener('click', backToAI);
      activeCard = richWrap(card);
      setTimeout(function () { focusInput(); scrollDown(); }, 150);
      return;
    }

    /* chưa kết nối: bắt buộc nhập số điện thoại / Zalo */
    var saved = '';
    try { saved = (JSON.parse(localStorage.getItem('gw_cust') || '{}').phone) || ''; } catch (_) {}
    card.innerHTML =
      '<h4></h4><p></p><form novalidate><input type="tel" inputmode="tel" autocomplete="tel" maxlength="20">' +
      '<div class="gwh-err" role="alert"></div><button type="submit"></button><button type="button" class="gwh-back"></button></form>';
    card.querySelector('h4').textContent = T('Kết nối với nhân viên GEWON', 'Connect with GEWON staff');
    card.querySelector('p').textContent = T('Nhập số điện thoại / Zalo để nhân viên liên hệ và trả lời anh/chị ngay tại đây (9:00–21:00 mỗi ngày).',
                                            'Enter your phone / Zalo number so our staff can reach you and reply right here (9:00–21:00 daily).');
    var ip = card.querySelector('input'); ip.placeholder = T('Số điện thoại / Zalo', 'Phone / Zalo number'); ip.value = saved;
    var btn = card.querySelector('button[type=submit]'); btn.textContent = T('Kết nối nhân viên', 'Connect to staff');
    var back = card.querySelector('.gwh-back'); back.textContent = T('← Quay lại trợ lý AI', '← Back to the AI assistant');
    back.addEventListener('click', backToAI);
    var err = card.querySelector('.gwh-err');
    card.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault(); e.stopPropagation();
      var phone = ip.value.trim();
      if (!phoneOk(phone)) { err.textContent = T('Số điện thoại chưa hợp lệ, ví dụ 0385 730 766.', 'Please enter a valid phone number, e.g. 0385 730 766.'); ip.focus(); return; }
      err.textContent = ''; btn.disabled = true; btn.textContent = T('Đang kết nối…', 'Connecting…');
      var body = ctxText(recent());   /* câu khách vừa hỏi AI: gửi kèm để nhân viên nắm ngữ cảnh */
      send(phone, body).then(function () {
        try { var c = JSON.parse(localStorage.getItem('gw_cust') || '{}'); c.phone = c.phone || phone; localStorage.setItem('gw_cust', JSON.stringify(c)); } catch (_) {}
        sound('ok');
        if (card.parentNode) card.parentNode.remove();
        activeCard = null;
        bubble(T('Mình để lại số ' + phone + ', nhờ nhân viên liên hệ.', 'My number is ' + phone + ' — please contact me.'), 'user');
        bubble(T('Dạ, em đã chuyển số ' + phone + ' cho nhân viên rồi ạ. Nhân viên sẽ liên hệ sớm (9:00–21:00). Anh/chị cũng có thể nhắn thẳng vào ô bên dưới, nhân viên sẽ trả lời ngay tại đây nhé.',
                 'Done — I passed ' + phone + ' to our staff. They will contact you soon (9:00–21:00). You can also type below; they will reply right here.'), 'bot');
        enterStaff(); schedulePoll(); focusInput();
      }).catch(function (er) {
        btn.disabled = false; btn.textContent = T('Kết nối nhân viên', 'Connect to staff');
        err.textContent = er && er.network ? T('Không kết nối được, vui lòng thử lại.', 'Could not connect, please try again.') : ((er && er.message) || T('Chưa gửi được, vui lòng thử lại.', 'Could not send, please try again.'));
      });
    });
    activeCard = richWrap(card);
    setTimeout(function () { if (!coarse()) { try { ip.focus({ preventScroll: true }); } catch (_) {} } scrollDown(); }, 150);
  }

  /* gửi: đã có hội thoại thì nối tiếp; chưa có thì tạo mới kèm số điện thoại (bắt buộc) */
  function send(phone, text) {
    function start() {
      return GWL.chatStart({ contact: phone, text: text, source: 'ngot' }).then(function (r) {
        chat = { id: r.id, token: r.token };
        try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch (_) {}
        seen = (r.chat.messages || []).length; try { localStorage.setItem(SEEN, String(seen)); } catch (_) {}
        return r;
      });
    }
    if (!chat) {
      if (!phone) { var g = new Error('Chưa có số điện thoại.'); g.gone = true; return Promise.reject(g); }
      return start();
    }
    return GWL.chatSend(chat.id, chat.token, text).then(function (r) {
      seen = (r.chat.messages || []).length; try { localStorage.setItem(SEEN, String(seen)); } catch (_) {}
      return r;
    }).catch(function (er) {
      if (er && er.status === 404) { chat = null; try { localStorage.removeItem(KEY); } catch (_) {} if (phone) return start(); }
      throw er;
    });
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
        if (m.from === 'staff') { say(m.text, 'bot', m.name || T('Nhân viên', 'Staff')); got = true; }
      });
      if (got) { sound('ding'); if (!panel.classList.contains('open')) dot.style.display = 'block'; }
    }).catch(function (e) { if (e && e.status === 404) { chat = null; try { localStorage.removeItem(KEY); } catch (_) {} } });
  }
  var timer = null;
  function schedulePoll() { if (!timer) timer = setInterval(pull, 4000); }
  if (chat) { schedulePoll(); pull(); }
  new MutationObserver(function () { if (panel.classList.contains('open')) { dot.style.display = 'none'; setTimeout(flush, 0); } })
    .observe(panel, { attributes: true, attributeFilter: ['class'] });

  /* ---------- tự báo trạng thái đơn ngay trong chat AI ---------- */
  var OSEEN = 'gw_ordseen';
  function loadOrders() { try { return (JSON.parse(localStorage.getItem('gw_orders') || '[]') || []).filter(function (o) { return o && o.srv && o.id && o.phone; }); } catch (_) { return []; } }
  var seenMap = null;
  try { seenMap = JSON.parse(localStorage.getItem(OSEEN) || 'null'); } catch (_) {}
  if (!seenMap) { /* lần đầu: coi trạng thái hiện có là đã biết, tránh báo lại đơn cũ */
    seenMap = {}; loadOrders().forEach(function (o) { seenMap[o.id] = o.sst || 'pending'; });
    try { localStorage.setItem(OSEEN, JSON.stringify(seenMap)); } catch (_) {}
  }
  function orderMsg(code, st) {
    var m = {
      confirmed: ['Dạ, đơn #' + code + ' của anh/chị đã được shop xác nhận ạ ✓', 'Good news — order #' + code + ' has been confirmed ✓'],
      preparing: ['Đơn #' + code + ' đang được shop chuẩn bị hàng ạ.', 'Order #' + code + ' is being prepared.'],
      shipped:   ['Đơn #' + code + ' đã được giao đi, đang trên đường đến anh/chị ạ 🚚', 'Order #' + code + ' is on its way to you 🚚'],
      delivered: ['Đơn #' + code + ' đã giao thành công. Cảm ơn anh/chị đã mua sắm tại GEWON ạ 🌹', 'Order #' + code + ' has been delivered. Thank you for shopping with GEWON 🌹'],
      cancelled: ['Đơn #' + code + ' đã được hủy ạ. Cần hỗ trợ thêm, anh/chị bấm “Gặp nhân viên” nhé.', 'Order #' + code + ' has been cancelled. Tap “Talk to staff” if you need help.'],
    }[st];
    return m ? T(m[0], m[1]) : null;
  }
  var tracking = false;
  function trackOrders() {
    if (tracking || document.hidden) return;
    var list = loadOrders(); if (!list.length) return;
    tracking = true;
    call('/api/orders/track', 'POST', { orders: list.map(function (o) { return { code: o.id, phone: o.phone }; }) }).then(function (r) {
      var any = false;
      (r.orders || []).forEach(function (s) {
        if (!s || s.status === 'missing') return;
        var prev = seenMap[s.code] || 'pending';
        if (prev === s.status) return;
        seenMap[s.code] = s.status;
        var t = orderMsg(s.code, s.status);
        if (t) { say(t, 'bot'); any = true; }
      });
      if (any) {
        try { localStorage.setItem(OSEEN, JSON.stringify(seenMap)); } catch (_) {}
        sound('ding'); if (!panel.classList.contains('open')) dot.style.display = 'block';
      }
    }).catch(function () {}).then(function () { tracking = false; });
  }
  setInterval(trackOrders, 8000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) trackOrders(); });
  setTimeout(trackOrders, 1500);

  /* ---------- kích hoạt ---------- */
  chip.addEventListener('click', function () { showCard(); });

  /* khách gõ "gặp nhân viên / tư vấn viên / người thật…" cũng mở thẻ này thay vì để AI đoán */
  var WANT = /(gap|noi chuyen|lien he|chat voi|nhan voi|can|muon|goi)\s+(nhan vien|tu van vien|nguoi that|admin|shop)|nhan vien|tu van vien|nguoi that|staff|human|real person|live agent|customer service/;
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd'); }
  panel.addEventListener('submit', function (e) {
    if (e.target !== form) return;
    var v = input.value.trim();
    if (!v) return;
    if (staffMode) { e.preventDefault(); e.stopPropagation(); input.value = ''; toStaff(v); return; }
    if (!WANT.test(norm(v))) return;
    e.preventDefault(); e.stopPropagation();
    input.value = '';
    bubble(v, 'user');
    showCard();
  }, true);
  panel.addEventListener('ngot:reset', function () { queue.length = 0; dot.style.display = 'none'; exitStaff(); });
  /* nút Zalo/Enter đã có sẵn ở các câu trả lời của AI nên không đụng tới */
})();
