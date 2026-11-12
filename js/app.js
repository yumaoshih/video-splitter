/* 頁面狀態與互動 */
(function () {
  'use strict';

  var MIN_MB = 10, MAX_MB = 4000;
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    drop: $('drop'), input: $('file-input'),
    chips: Array.prototype.slice.call(document.querySelectorAll('.chip')),
    sizeWrap: $('size-wrap'), size: $('size-input'),
    card: $('file-card'), name: $('file-name'), meta: $('file-meta'), count: $('plan-count'),
    start: $('btn-start'), change: $('btn-change'),
    error: $('note-error'), segments: $('segments'),
    statusLabel: $('status-label'), statusPct: $('status-pct'), bar: $('bar'), barFill: $('bar-fill'),
    list: $('seg-list'), done: $('note-done')
  };

  var state = {
    file: null, mp4: null, plan: null, maxMB: 500,
    busy: false, urls: []
  };
  var splitter = new Splitter();

  /* ── helpers ── */
  function fmtMB(bytes) { return (bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1) + ' MB'; }
  function fmtDur(sec) {
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    var mm = (h ? String(m).padStart(2, '0') : m), ss = String(s).padStart(2, '0');
    return (h ? h + ':' : '') + mm + ':' + ss;
  }
  function baseName(name) { return name.replace(/\.[^.]+$/, ''); }
  function showError(msg) { els.error.textContent = msg; els.error.classList.add('is-visible'); }
  function clearError() { els.error.classList.remove('is-visible'); els.error.textContent = ''; }
  function setProgress(ratio) {
    els.bar.classList.remove('is-indeterminate');
    els.barFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, ratio)) + ')';
    els.statusPct.textContent = Math.round(ratio * 100) + '%';
  }
  function setIndeterminate() { els.bar.classList.add('is-indeterminate'); els.statusPct.textContent = ''; }
  function revokeAll() { state.urls.forEach(function (u) { URL.revokeObjectURL(u); }); state.urls = []; }

  /* ── size setting ── */
  function readSize() {
    var v = parseInt(els.size.value, 10);
    var ok = Number.isFinite(v) && v >= MIN_MB && v <= MAX_MB;
    els.sizeWrap.classList.toggle('is-invalid', !ok);
    if (ok) state.maxMB = v;
    els.chips.forEach(function (c) { c.setAttribute('aria-pressed', String(ok && Number(c.dataset.mb) === v)); });
    return ok;
  }
  els.chips.forEach(function (c) {
    c.addEventListener('click', function () { els.size.value = c.dataset.mb; readSize(); replan(); });
  });
  els.size.addEventListener('input', function () { if (readSize()) replan(); });

  /* ── file selection ── */
  function pickFile(file) {
    if (!file || state.busy) return;
    clearError();
    revokeAll();
    resetSegments();
    state.file = file; state.mp4 = null; state.plan = null;
    els.name.textContent = file.name;
    els.meta.textContent = fmtMB(file.size) + ' · 讀取索引中…';
    els.card.classList.add('is-visible');
    els.start.disabled = true;

    readMp4Index(file).then(function (mp4) {
      if (state.file !== file) return;
      state.mp4 = mp4;
      replan();
      splitter.load(function () {}).catch(function () {}); // 先在背景載入引擎
    }).catch(function (err) {
      if (state.file !== file) return;
      els.card.classList.remove('is-visible');
      state.file = null;
      showError(err.message || String(err));
    });
  }

  function replan() {
    if (!state.mp4 || !state.file) return;
    var plan;
    try {
      plan = computeSplitPlan(state.mp4, state.maxMB * 1000 * 1000);
    } catch (err) { showError(err.message); return; }
    state.plan = plan;
    var n = plan.segments.length;
    els.meta.textContent = fmtMB(state.file.size) + ' · ' + fmtDur(plan.duration);
    if (n === 1) {
      els.count.innerHTML = '這個檔案已小於 ' + state.maxMB + ' MB，<span>不需要切割</span>';
      els.count.classList.add('is-warn');
      els.start.disabled = true;
    } else {
      els.count.innerHTML = '將切成 <b>' + n + '</b> 段，每段不超過 ' + state.maxMB + ' MB';
      els.count.classList.remove('is-warn');
      els.start.disabled = false;
    }
    renderSegments(plan);
  }

  els.input.addEventListener('change', function () { pickFile(els.input.files[0]); els.input.value = ''; });
  ['dragenter', 'dragover'].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); if (!state.busy) els.drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    els.drop.addEventListener(ev, function (e) { e.preventDefault(); els.drop.classList.remove('is-over'); });
  });
  els.drop.addEventListener('drop', function (e) { pickFile(e.dataTransfer.files[0]); });
  els.drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.input.click(); } });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });

  els.change.addEventListener('click', function () { if (!state.busy) els.input.click(); });

  /* ── segments list ── */
  function resetSegments() {
    els.segments.classList.remove('is-visible');
    els.list.innerHTML = '';
    els.done.classList.remove('is-visible');
    els.statusLabel.textContent = ''; els.statusLabel.classList.remove('is-error');
    setProgress(0);
  }

  function segName(i) { return baseName(state.file.name) + '_part_' + String(i + 1).padStart(2, '0') + '.mp4'; }

  function renderSegments(plan) {
    els.list.innerHTML = '';
    plan.segments.forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = 'seg'; li.id = 'seg-' + i;
      li.innerHTML =
        '<span class="idx">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span><div class="seg-name">' + escapeHtml(segName(i)) + '</div>' +
        '<div class="seg-meta">' + fmtDur(s.start) + ' – ' + fmtDur(s.end) + ' · 約 ' + fmtMB(s.bytes) +
        (s.bytes > state.maxMB * 1000 * 1000 ? ' <span class="warn">單一關鍵影格區間已超過上限，無法再切小</span>' : '') + '</div></span>' +
        '<span class="state"><span class="txt">等待中</span></span>';
      els.list.appendChild(li);
    });
    els.segments.classList.toggle('is-visible', plan.segments.length > 1);
    els.statusLabel.textContent = '準備就緒';
    els.statusPct.textContent = '';
  }

  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function setSegState(i, html, active) {
    var li = $('seg-' + i); if (!li) return;
    li.querySelector('.state').innerHTML = html;
    li.classList.toggle('is-active', !!active);
  }

  function segDone(i, blob) {
    var url = URL.createObjectURL(blob); state.urls.push(url);
    var name = segName(i);
    var li = $('seg-' + i);
    var meta = li.querySelector('.seg-meta');
    var over = blob.size > state.maxMB * 1000 * 1000;
    meta.innerHTML = meta.textContent.replace(/約 .*$/, '') + '<b>' + fmtMB(blob.size) + '</b>' + (over ? ' <span class="warn">超過上限</span>' : '');
    setSegState(i,
      '<span class="ok" aria-label="完成"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></span>' +
      '<a class="btn btn-sm" href="' + url + '" download="' + escapeHtml(name) + '">下載</a>', false);
    // 自動下載
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  /* ── run ── */
  function setBusy(b) {
    state.busy = b;
    els.start.disabled = b; els.change.disabled = b; els.size.disabled = b;
    els.chips.forEach(function (c) { c.disabled = b; });
    els.drop.classList.toggle('is-disabled', b);
  }

  function run() {
    if (!state.plan || state.busy || !readSize()) return;
    var file = state.file, plan = state.plan, segs = plan.segments;
    clearError(); revokeAll();
    setBusy(true);
    els.segments.classList.add('is-visible');
    els.done.classList.remove('is-visible');
    els.statusLabel.classList.remove('is-error');
    segs.forEach(function (_, i) { setSegState(i, '<span class="txt">等待中</span>', false); });

    var started = Date.now();
    els.statusLabel.textContent = '載入切割引擎（約 32 MB，只需一次）';
    setIndeterminate();

    splitter.load(function (r) { setProgress(r); })
      .then(function () { return splitter.mount(file); })
      .then(function () {
        var i = 0;
        function next() {
          if (i >= segs.length) return;
          var idx = i++;
          setSegState(idx, '<span class="spin" aria-hidden="true"></span><span class="txt">切割中</span>', true);
          els.statusLabel.textContent = '切割第 ' + (idx + 1) + ' / ' + segs.length + ' 段';
          setProgress(idx / segs.length);
          return splitter.cutSegment(segs[idx], idx === segs.length - 1, function (r) {
            setProgress((idx + r) / segs.length);
          }).then(function (blob) {
            segDone(idx, blob);
            return next();
          });
        }
        return next();
      })
      .then(function () {
        setProgress(1);
        els.statusLabel.textContent = '全部完成';
        var secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        els.done.textContent = segs.length + ' 段檔案已自動下載到你的下載資料夾（耗時 ' + secs + ' 秒）。若瀏覽器詢問「允許下載多個檔案」，請選擇允許；也可以按每一列的「下載」重新取得。';
        els.done.classList.add('is-visible');
      })
      .catch(function (err) {
        console.error(err);
        els.statusLabel.textContent = '切割失敗';
        els.statusLabel.classList.add('is-error');
        els.bar.classList.remove('is-indeterminate');
        showError('發生錯誤：' + (err && err.message ? err.message : err) + '。請確認檔案是 MP4 / MOV，或改用較小的分段大小再試。');
      })
      .then(function () { return splitter.unmount(); })
      .then(function () { setBusy(false); if (state.plan) els.start.disabled = state.plan.segments.length < 2; });
  }
  els.start.addEventListener('click', run);

  /* 測試用：讓自動化測試可以直接餵檔案並取得結果 */
  window.__splitter = {
    pick: pickFile, run: run, replan: replan, state: state,
    setAutoDownload: function (on) { segDone = on ? segDone : segDoneNoDownload; }
  };
  function segDoneNoDownload(i, blob) {
    state.results = state.results || [];
    state.results[i] = { name: segName(i), size: blob.size, blob: blob };
    var li = $('seg-' + i);
    li.querySelector('.seg-meta').innerHTML += ' · 實際 ' + fmtMB(blob.size);
    setSegState(i, '<span class="ok"><svg viewBox="0 0 24 24"><path d="M5 12l5 5L19 7"/></svg></span>', false);
  }

  readSize();
})();
