/* 用 mp4box.js 只讀取 MP4/MOV 的索引（moov），不載入整個檔案。 */
(function (root) {
  'use strict';

  var CHUNK = 1 << 20;          // 每次讀 1MB
  var MAX_SCAN = 64 << 20;      // 索引最多掃 64MB，超過視為非 MP4

  // MP4 / MOV 開頭常見的 box 類型；不是這些就直接判定不是 ISOBMFF，避免 mp4box 對垃圾資料逐 byte 掃描
  var LEADING_BOXES = { ftyp: 1, moov: 1, mdat: 1, free: 1, skip: 1, wide: 1, pdin: 1, moof: 1, styp: 1, sidx: 1, uuid: 1 };

  function silenceLog() {
    var L = (MP4Box.Log && MP4Box.Log.setLogLevel) ? MP4Box.Log : (typeof Log !== 'undefined' && Log.setLogLevel ? Log : null);
    if (!L) return;
    L.setLogLevel(L.error);
    ['debug', 'info', 'warn', 'error'].forEach(function (k) { if (typeof L[k] === 'function') L[k] = function () {}; });
  }

  function looksLikeIsobmff(file) {
    return file.slice(0, 8).arrayBuffer().then(function (ab) {
      if (ab.byteLength < 8) return false;
      var b = new Uint8Array(ab);
      var type = String.fromCharCode(b[4], b[5], b[6], b[7]);
      return !!LEADING_BOXES[type];
    });
  }

  /**
   * @param {File} file
   * @returns {Promise<object>} mp4box ISOFile（已 onReady）
   */
  function readMp4Index(file) {
    if (typeof MP4Box === 'undefined') return Promise.reject(new Error('mp4box.js 尚未載入'));
    return looksLikeIsobmff(file).then(function (ok) {
      if (!ok) throw new Error('這個檔案不是 MP4 / MOV（檔頭不符）。');
      return parseIndex(file);
    });
  }

  function parseIndex(file) {
    return new Promise(function (resolve, reject) {
      silenceLog();

      var mp4 = MP4Box.createFile();
      var pos = 0, scanned = 0, done = false;

      mp4.onError = function (e) { if (!done) { done = true; reject(new Error('無法解析影片索引：' + e)); } };
      mp4.onReady = function () { if (!done) { done = true; resolve(mp4); } };

      function step() {
        if (done) return;
        if (pos >= file.size || scanned > MAX_SCAN) {
          done = true;
          return reject(new Error('找不到影片索引，這個檔案可能不是 MP4 / MOV。'));
        }
        var end = Math.min(pos + CHUNK, file.size);
        file.slice(pos, end).arrayBuffer().then(function (ab) {
          ab.fileStart = pos;
          scanned += ab.byteLength;
          var next = mp4.appendBuffer(ab);
          if (done) return;
          if (typeof next !== 'number' || next <= pos) next = end;
          pos = next;
          step();
        }).catch(function (err) {
          if (!done) { done = true; reject(err); }
        });
      }
      step();
    });
  }

  root.readMp4Index = readMp4Index;
})(self);
