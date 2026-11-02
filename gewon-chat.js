/* GEWON — khung chat "Nhắn nhân viên" trên cửa hàng. Tin nhắn hiện ở tab "Tin nhắn khách" của staff.html. */
(function () {
  'use strict';
  if (!window.GWL) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var en = function () { try { return localStorage.getItem('gw_lang') === 'en'; } catch (e) { return false; } };
  var T = function (vi, e) { return en() ? e : vi; };
  var load = function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  var store = function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var S = load('gw_chat'), seen = Number(localStorage.getItem('gw_chat_seen') || 0), chat = null, open = false, timer = null;

  var css = document.createElement('style');
  css.textContent = '#gwc-btn{position:fixed;left:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:58;height:46px;padding:0 18px;border:1px solid #fff4;border-radius:99px;background:#111;color:#fff;font:600 14px "Inter Tight",system-ui,sans-serif;cursor:pointer;box-shadow:0 10px 30px #0006;display:flex;align-items:center;gap:8px}' +
    '#gwc-btn b{background:#e9a35a;color:#111;border-radius:99px;min-width:20px;height:20px;display:none;place-items:center;font-size:11px;padding:0 5px}#gwc-btn b.on{display:grid}' +
    '#gwc-p{position:fixed;left:16px;bottom:calc(72px + env(safe-area-inset-bottom,0px));z-index:59;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100dvh - 120px));background:#161616;color:#f4f4f4;border:1px solid #fff3;border-radius:16px;box-shadow:0 24px 80px #000a;display:none;flex-direction:column;overflow:hidden;font:500 14px/1.4 "Inter Tight",system-ui,sans-serif}#gwc-p.on{display:flex}' +
    '#gwc-h{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #fff2;font-weight:600}#gwc-h button{background:none;border:0;color:#fff;font-size:16px;cursor:pointer}' +
    '#gwc-m{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px}' +
    '.gwc-b{max-width:84%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13.5px}.gwc-b.customer{align-self:flex-end;background:#fff;color:#111}.gwc-b.staff{align-self:flex-start;background:#2a2a2a}.gwc-b.auto{align-self:center;background:#222;color:#aaa;font-size:12px}' +
    '#gwc-f{display:flex;flex-direction:column;gap:8px;padding:12px;border-top:1px solid #fff2}#gwc-f input,#gwc-f textarea{font:inherit;color:#f4f4f4;background:#0d0d0d;border:1px solid #fff3;border-radius:10px;padding:9px 11px;width:100%;resize:none;outline:0}#gwc-f input:focus,#gwc-f textarea:focus{border-color:#fff}' +
    '#gwc-f .r{display:flex;gap:8px}#gwc-f button{border:0;border-radius:99px;background:#fff;color:#111;font:600 13px inherit;padding:0 18px;cursor:pointer;min-height:40px}#gwc-e{color:#f0a39a;font-size:12px;min-height:0}';
  document.head.appendChild(css);

  var btn = document.createElement('button');
  btn.id = 'gwc-btn'; btn.type = 'button';
  btn.innerHTML = '<span>💬</span><span class="t"></span><b></b>';
  var p = document.createElement('section');
  p.id = 'gwc-p'; p.setAttribute('aria-label', 'Chat');
  p.innerHTML = '<div id="gwc-h"><span class="t"></span><button type="button" aria-label="Close">✕</button></div><div id="gwc-m"></div>' +
    '<form id="gwc-f"><input id="gwc-c" inputmode="tel" maxlength="16" autocomplete="tel"><textarea id="gwc-t" rows="2" maxlength="1000"></textarea><div id="gwc-e" role="alert"></div><div class="r"><button type="submit"></button></div></form>';
  document.body.appendChild(btn); document.body.appendChild(p);
  var box = $('#gwc-m', p), form = $('#gwc-f', p), inC = $('#gwc-c', p), inT = $('#gwc-t', p), err = $('#gwc-e', p), badge = $('b', btn);

  function labels() {
    $('.t', btn).textContent = T('Nhắn nhân viên', 'Chat with staff');
    $('#gwc-h .t', p).textContent = T('Chat với nhân viên Gewon', 'Chat with Gewon staff');
    inC.placeholder = T('Số điện thoại / Zalo của bạn', 'Your phone / Zalo number');
    inT.placeholder = T('Nhập tin nhắn…', 'Type a message…');
    $('button', form).textContent = T('Gửi', 'Send');
    inC.style.display = S ? 'none' : '';
  }
  function render() {
    box.replaceChildren();
    if (!chat) {
      var n = document.createElement('div'); n.className = 'gwc-b auto';
      n.textContent = T('Xin chào! Để lại số điện thoại và câu hỏi, nhân viên sẽ trả lời bạn tại đây (9:00–21:00).', 'Hi! Leave your phone number and question and our staff will reply here (9:00–21:00).');
      box.appendChild(n); return;
    }
    chat.messages.forEach(function (m) {
      var d = document.createElement('div'); d.className = 'gwc-b ' + m.from; d.textContent = m.text; box.appendChild(d);
    });
    box.scrollTop = box.scrollHeight;
  }
  function unread() { return chat ? chat.messages.slice(seen).filter(function (m) { return m.from === 'staff'; }).length : 0; }
  function mark() { if (chat) { seen = chat.messages.length; localStorage.setItem('gw_chat_seen', String(seen)); } }
  function badgeUpd() { var u = open ? 0 : unread(); badge.textContent = u; badge.classList.toggle('on', u > 0); }
  function poll() {
    if (!S || document.hidden) return;
    GWL.chatPoll(S.id, S.token).then(function (c) {
      var changed = !chat || c.messages.length !== chat.messages.length; chat = c;
      if (open) { mark(); if (changed) render(); } badgeUpd();
    }).catch(function (e) { if (e.status === 404) { S = null; chat = null; store('gw_chat', null); labels(); render(); } });
  }
  function schedule() { clearInterval(timer); timer = setInterval(poll, open ? 3000 : 15000); }
  function toggle(o) {
    open = o; p.classList.toggle('on', o); schedule();
    if (o) {
      var c = load('gw_cust'); if (c && c.phone && !inC.value) inC.value = c.phone;
      labels(); render(); mark(); badgeUpd(); poll(); (S ? inT : inC).focus();
    }
  }
  btn.onclick = function () { toggle(!open); };
  $('#gwc-h button', p).onclick = function () { toggle(false); };
  addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) toggle(false); });
  inT.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
  form.onsubmit = function (e) {
    e.preventDefault(); err.textContent = '';
    var text = inT.value.trim(); if (!text) return;
    var sb = $('button', form); sb.disabled = true;
    var job = S ? GWL.chatSend(S.id, S.token, text).then(function (c) { chat = c; })
      : GWL.chatStart(inC.value.trim(), text).then(function (r) { S = { id: r.id, token: r.token }; store('gw_chat', S); chat = r.chat; labels(); });
    job.then(function () { inT.value = ''; mark(); render(); badgeUpd(); })
      .catch(function (er) { err.textContent = er.network ? T('Không kết nối được máy chủ. Hãy thử Zalo 0385730766.', 'Cannot reach the server. Try Zalo 0385730766.') : er.message; })
      .then(function () { sb.disabled = false; });
  };
  labels(); render(); schedule(); poll();
})();
