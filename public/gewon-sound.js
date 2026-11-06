/* GEWON — âm thanh cho cửa hàng: nhạc nền (chanh.mp3) + hiệu ứng bấm/thêm giỏ/tin nhắn.
   Trình duyệt điện thoại chỉ cho phát tiếng SAU lần chạm đầu tiên, nên nhạc bắt đầu ở lần chạm đầu.
   Nút 🔊/🔇 góc trái dưới để bật/tắt; lựa chọn được nhớ lại. */
(function () {
  'use strict';
  var KEY = 'gw_sound';
  var on = true;
  try { on = localStorage.getItem(KEY) !== '0'; } catch (_) {}
  var en = function () { try { return localStorage.getItem('gw_lang') === 'en'; } catch (_) { return false; } };

  /* ---------- hiệu ứng (tạo bằng WebAudio, không cần file) ---------- */
  var ctx = null;
  function ac() {
    if (!ctx) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { ctx = new C(); } catch (_) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    return ctx;
  }
  function tone(freq, start, dur, vol, type) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + start, o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
  }
  var SFX = {
    tap:  function () { tone(620, 0, 0.06, 0.05, 'triangle'); },
    add:  function () { tone(660, 0, 0.12, 0.09); tone(990, 0.09, 0.2, 0.09); },
    open: function () { tone(440, 0, 0.1, 0.05, 'triangle'); tone(660, 0.06, 0.12, 0.05, 'triangle'); },
    send: function () { tone(740, 0, 0.09, 0.07); tone(1110, 0.07, 0.12, 0.06); },
    ding: function () { tone(988, 0, 0.25, 0.12); tone(1480, 0.13, 0.4, 0.1); },
    ok:   function () { tone(523, 0, 0.12, 0.09); tone(659, 0.1, 0.12, 0.09); tone(784, 0.2, 0.3, 0.09); },
  };
  function play(name) { if (!on) return; try { (SFX[name] || SFX.tap)(); } catch (_) {} }

  /* ---------- nhạc nền ---------- */
  var music = new Audio();
  music.src = '/chanh.mp3'; music.loop = true; music.preload = 'none';
  music.setAttribute('playsinline', '');
  var wantMusic = false, started = false;
  var TARGET = 0.4, START = 0.02;          /* âm lượng cuối / lúc bắt đầu (rất nhỏ) */
  var gain = null, fadeTimer = null;
  /* iPhone bỏ qua audio.volume → dùng GainNode để tăng dần được trên mọi máy */
  function setupGain() {
    if (gain) return true;
    var c = ac(); if (!c) return false;
    try {
      var src = c.createMediaElementSource(music);
      gain = c.createGain(); gain.gain.value = START;
      src.connect(gain); gain.connect(c.destination); music.volume = 1;
      return true;
    } catch (_) { gain = null; return false; }
  }
  function fadeIn(sec) {
    clearInterval(fadeTimer);
    if (gain) {
      var t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(START, t);
      gain.gain.linearRampToValueAtTime(TARGET, t + sec);
    } else {
      var t0 = Date.now(); music.volume = START;
      fadeTimer = setInterval(function () {
        var k = Math.min(1, (Date.now() - t0) / (sec * 1000));
        music.volume = START + (TARGET - START) * k;
        if (k >= 1) clearInterval(fadeTimer);
      }, 200);
    }
  }
  function startMusic(sec) {
    if (!on) return;
    wantMusic = true;
    setupGain();
    if (gain) { var t = ctx.currentTime; gain.gain.cancelScheduledValues(t); gain.gain.setValueAtTime(START, t); } else { music.volume = START; }
    var p = music.play();
    if (p && p.then) p.then(function () { fadeIn(sec || 12); }).catch(function () { started = false; });
    else fadeIn(sec || 12);
  }
  function stopMusic() { wantMusic = false; try { music.pause(); } catch (_) {} }

  /* mở khoá âm thanh ở lần chạm đầu tiên (bắt buộc trên iOS/Android) */
  function unlock() {
    ac();
    if (on && !started) { started = true; startMusic(); }
    if (started && !music.paused) detach();
  }
  var evs = ['touchend', 'pointerup', 'click', 'keydown'];
  function detach() { evs.forEach(function (e) { document.removeEventListener(e, unlock, true); }); }
  evs.forEach(function (e) { document.addEventListener(e, unlock, true); });

  /* tạm dừng khi rời tab / khoá màn hình, tiếp tục khi quay lại */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { try { music.pause(); } catch (_) {} }
    else if (on && wantMusic) startMusic(4);
  });

  /* ---------- nút bật/tắt ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#gw-snd{position:fixed;left:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:60;width:44px;height:44px;border-radius:50%;border:1px solid #ffffff40;background:#111c;color:#fff;font-size:19px;line-height:1;display:grid;place-items:center;cursor:pointer;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 6px 18px #0005;padding:0;-webkit-tap-highlight-color:transparent}' +
    '#gw-snd.off{opacity:.7}';
  document.head.appendChild(css);
  var btn = document.createElement('button');
  btn.id = 'gw-snd'; btn.type = 'button';
  function paint() {
    btn.textContent = on ? '🔊' : '🔇';
    btn.classList.toggle('off', !on);
    var l = on ? (en() ? 'Turn sound off' : 'Tắt âm thanh') : (en() ? 'Turn sound on' : 'Bật âm thanh');
    btn.setAttribute('aria-label', l); btn.title = l; btn.setAttribute('aria-pressed', String(on));
  }
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    on = !on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
    if (on) { started = true; startMusic(); play('ok'); } else { stopMusic(); }
    paint();
  });
  paint();
  /* trên điện thoại khung chat phủ gần hết màn hình → ẩn nút âm thanh khi chat đang mở */
  function watchChat() {
    var p = document.getElementById('ngot-panel');
    if (!p || !window.MutationObserver) return;
    new MutationObserver(function () {
      btn.style.display = (p.classList.contains('open') && matchMedia('(max-width:520px)').matches) ? 'none' : '';
    }).observe(p, { attributes: true, attributeFilter: ['class'] });
  }
  (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); })).then(function () { document.body.appendChild(btn); watchChat(); });

  /* ---------- gắn tiếng vào thao tác ---------- */
  document.addEventListener('click', function (e) {
    if (e.target.closest('#gw-snd')) return;
    if (e.target.closest('#qa,.ad')) { play('add'); return; }
    if (e.target.closest('#ngot-launch,#cartbtn,#ordbtn,#burger,.pc')) { play('open'); return; }
    if (e.target.closest('#ngot-form button[type=submit]')) { play('send'); return; }
    if (e.target.closest('button,a,.hmc,.hmcard')) play('tap');
  }, true);

  window.GWSound = { play: play, isOn: function () { return on; }, level: function () { return gain ? gain.gain.value : music.volume; } };
})();
