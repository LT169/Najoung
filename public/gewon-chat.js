/* GEWON — khung chat với nhân viên (nối /api/chat). Nhân viên trả lời ở /staff. */
(function () {
  'use strict';
  if (!window.GWL) return;
  var KEY = 'gw_staffchat';
  var chat = null; // { id, token }
  try { chat = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { chat = null; }
  var en = function () { try { return localStorage.getItem('gw_lang') === 'en'; } catch (_) { return false; } };
  var T = function (vi, e) { return en() ? e : vi; };

  var css = document.createElement('style');
  css.textContent =
    '#gwc-btn{position:fixed;right:24px;bottom:96px;z-index:99998;height:44px;padding:0 16px;border:1px solid #ffffff35;border-radius:22px;background:#fff;color:#111;font:600 13px Inter,Arial,sans-serif;box-shadow:0 8px 24px #0004;cursor:pointer}' +
    '#gwc-panel{position:fixed;right:24px;bottom:150px;z-index:99998;width:min(350px,calc(100vw - 28px));height:min(470px,calc(100dvh - 180px));background:#f8f7f4;color:#171717;border:1px solid #dedbd5;border-radius:16px;box-shadow:0 20px 60px #0005;display:none;flex-direction:column;overflow:hidden;font:14px Inter,Arial,sans-serif}' +
    '#gwc-panel.open{display:flex}' +
    '#gwc-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#111;color:#fff;font-weight:600}' +
    '#gwc-head button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;line-height:1}' +
    '#gwc-msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}' +
    '.gwc-m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word;line-height:1.4}' +
    '.gwc-m.customer{align-self:flex-end;background:#111;color:#fff}' +
    '.gwc-m.staff{align-self:flex-start;background:#fff;border:1px solid #dedbd5}' +
    '.gwc-m.auto{align-self:center;background:#ece9e2;color:#555;font-size:12px}' +
    '.gwc-m small{display:block;opacity:.6;font-size:11px;margin-bottom:2px}' +
    '#gwc-form{display:flex;flex-direction:column;gap:8px;padding:10px;border-top:1px solid #dedbd5;background:#fff}' +
    '#gwc-form input,#gwc-form textarea{border:1px solid #cfcac1;border-radius:10px;padding:9px 10px;font:inherit;resize:none;width:100%;box-sizing:border-box}' +
    '#gwc-form .row{display:flex;gap:8px}#gwc-form .row textarea{flex:1}' +
    '#gwc-form button{border:0;border-radius:10px;background:#111;color:#fff;padding:0 14px;font-weight:600;cursor:pointer;min-height:38px}' +
    '#gwc-err{color:#b3261e;font-size:12px;min-height:14px;padding:0 12px}' +
    '@media(max-width:520px){#gwc-btn{right:13px;bottom:84px}#gwc-panel{right:13px;bottom:136px}}';
  document.head.appendChild(css);

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  var btn = el('button', { id: 'gwc-btn', type: 'button' }, T('💬 Chat nhân viên', '💬 Chat with staff'));
  var panel = el('section', { id: 'gwc-panel', 'aria-label': 'Chat' });
  var head = el('div', { id: 'gwc-head' });
  var title = el('span', null, T('Nhắn nhân viên GEWON', 'Message GEWON staff'));
  var x = el('button', { type: 'button', 'aria-label': 'Close' }, '×');
  head.appendChild(title); head.appendChild(x);
  var msgs = el('div', { id: 'gwc-msgs', 'aria-live': 'polite' });
  var err = el('div', { id: 'gwc-err' });
  var form = el('form', { id: 'gwc-form' });
  var phone = el('input', { type: 'tel', placeholder: T('Số điện thoại / Zalo', 'Phone / Zalo number'), autocomplete: 'tel', maxlength: '20' });
  var text = el('textarea', { rows: '2', placeholder: T('Nhập tin nhắn…', 'Type a message…'), maxlength: '1000' });
  var send = el('button', { type: 'submit' }, T('Gửi', 'Send'));
  var row = el('div', { class: 'row' });
  row.appendChild(text); row.appendChild(send);
  form.appendChild(phone); form.appendChild(row);
  panel.appendChild(head); panel.appendChild(msgs); panel.appendChild(err); panel.appendChild(form);
  document.body.appendChild(btn); document.body.appendChild(panel);

  function render(list) {
    var atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 60;
    msgs.textContent = '';
    if (!list || !list.length) {
      msgs.appendChild(el('div', { class: 'gwc-m auto' }, T('Để lại số điện thoại và tin nhắn, nhân viên sẽ trả lời bạn (9:00–21:00 mỗi ngày).', 'Leave your phone number and a message — staff will reply (9:00–21:00 daily).')));
    } else {
      list.forEach(function (m) {
        var d = el('div', { class: 'gwc-m ' + (m.from === 'customer' || m.from === 'staff' ? m.from : 'auto') });
        if (m.from === 'staff') d.appendChild(el('small', null, m.name || T('Nhân viên', 'Staff')));
        d.appendChild(document.createTextNode(m.text));
        msgs.appendChild(d);
      });
    }
    if (atBottom) msgs.scrollTop = msgs.scrollHeight;
  }
  function syncForm() { phone.style.display = chat ? 'none' : ''; }
  function setErr(t) { err.textContent = t || ''; }
  function reset() { chat = null; try { localStorage.removeItem(KEY); } catch (_) {} syncForm(); render([]); }

  function poll() {
    if (!chat || document.hidden || !panel.classList.contains('open')) return;
    GWL.chatGet(chat.id, chat.token).then(function (r) { render(r.chat.messages); }).catch(function (e) { if (e.status === 404) reset(); });
  }
  setInterval(poll, 5000);

  function open() {
    var ng = document.getElementById('ngot-panel');
    if (ng && ng.classList.contains('open')) { var c = document.getElementById('ngot-close'); if (c) c.click(); }
    panel.classList.add('open'); syncForm(); setErr('');
    render([]); poll();
    if (chat) poll();
  }
  btn.onclick = function () { panel.classList.contains('open') ? panel.classList.remove('open') : open(); };
  x.onclick = function () { panel.classList.remove('open'); };

  form.onsubmit = function (e) {
    e.preventDefault();
    var t = text.value.trim();
    if (!t) return;
    setErr(''); send.disabled = true;
    var p = chat
      ? GWL.chatSend(chat.id, chat.token, t)
      : GWL.chatStart({ contact: phone.value.trim(), text: t });
    p.then(function (r) {
      if (!chat) { chat = { id: r.id, token: r.token }; try { localStorage.setItem(KEY, JSON.stringify(chat)); } catch (_) {} syncForm(); }
      text.value = ''; render(r.chat.messages); msgs.scrollTop = msgs.scrollHeight;
    }).catch(function (er) {
      if (er.status === 404 && chat) { reset(); setErr(T('Cuộc trò chuyện đã hết hạn, hãy gửi lại.', 'Conversation expired, please send again.')); }
      else setErr(er.network ? T('Không kết nối được, thử lại sau.', 'Could not connect, try again.') : er.message);
    }).then(function () { send.disabled = false; });
  };
  text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });

  /* ẩn nút này khi khung chat Ngot đang mở để không đè lên nhau */
  var ng = document.getElementById('ngot-panel');
  if (ng && window.MutationObserver) {
    new MutationObserver(function () {
      var o = ng.classList.contains('open');
      btn.style.display = o ? 'none' : '';
      if (o) panel.classList.remove('open');
    }).observe(ng, { attributes: true, attributeFilter: ['class'] });
  }
})();
