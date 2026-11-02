/* GEWON — client API dùng chung cho cửa hàng (index.html) và khu vực nhân viên (staff.html). */
(function () {
  'use strict';
  function req(method, url, body) {
    var o = { method: method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Yêu cầu thất bại (' + r.status + ')'); e.status = r.status; throw e; }
        return j;
      });
    }, function () { var e = new Error('Không kết nối được máy chủ.'); e.network = true; throw e; });
  }
  window.GWL = {
    RATE: (window.GW_BOOT && window.GW_BOOT.rate) || 25000,
    req: req,
    products: function () { return req('GET', '/api/products').then(function (j) { return j.products; }); },
    placeOrder: function (p) { return req('POST', '/api/orders', p).then(function (j) { return j.order; }); },
    track: function (list) { return req('POST', '/api/orders/track', { orders: list }); },
    cancel: function (code, phone) { return req('POST', '/api/orders/' + encodeURIComponent(code) + '/cancel', { phone: phone }); },
    reviews: function () { return req('GET', '/api/reviews').then(function (j) { return j.reviews; }); },
    postReview: function (p) { return req('POST', '/api/reviews', p).then(function (j) { return j.review; }); },
    chatStart: function (contact, text) { return req('POST', '/api/chat', { contact: contact, text: text }); },
    chatSend: function (id, token, text) { return req('POST', '/api/chat/' + id + '/messages', { token: token, text: text }).then(function (j) { return j.chat; }); },
    chatPoll: function (id, token) { return req('GET', '/api/chat/' + id + '/messages?token=' + encodeURIComponent(token)).then(function (j) { return j.chat; }); }
  };
})();
