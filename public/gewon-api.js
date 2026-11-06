(function () {
  'use strict';
  async function call(url, opts) {
    opts = opts || {};
    const headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(url, { method: opts.method || 'GET', headers: headers, credentials: 'same-origin', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    } catch (e) { const err = new Error('Không kết nối được tới cửa hàng.'); err.network = true; throw err; }
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error(data.error || 'Yêu cầu thất bại (' + res.status + ').');
      err.status = res.status;
      if (res.status >= 502 && res.status <= 504) err.network = true;
      throw err;
    }
    return data;
  }
  window.GWL = {
    reviews: function () { return call('/api/reviews').then(function (r) { return r.reviews || []; }); },
    postReview: function (b) { return call('/api/reviews', { method: 'POST', body: b }).then(function (r) { return r.review; }); },
    placeOrder: function (b) { return call('/api/orders', { method: 'POST', body: b }).then(function (r) { return r.order; }); },
    cancel: function (code, phone) { return call('/api/orders/' + encodeURIComponent(code) + '/cancel', { method: 'POST', body: { phone: phone } }); },
    track: function (list) { return call('/api/orders/track', { method: 'POST', body: { orders: list } }); },
    chatStart: function (b) { return call('/api/chat', { method: 'POST', body: b }); },
    chatSend: function (id, token, text) { return call('/api/chat/' + encodeURIComponent(id) + '/messages', { method: 'POST', body: { token: token, text: text } }); },
    chatGet: function (id, token) { return call('/api/chat/' + encodeURIComponent(id) + '/messages?token=' + encodeURIComponent(token)); },
  };
})();
