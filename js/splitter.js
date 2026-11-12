/* ffmpeg.wasm 包裝：載入引擎、掛載檔案、逐段以 -c copy 切出 MP4。 */
(function (root) {
  'use strict';

  // @ffmpeg/ffmpeg 0.12.15 的 ESM 版放在 vendor/ 同源載入（worker 必須同源）；核心與 wasm 由 CDN 取得。
  var FFMPEG_MODULE = new URL('vendor/ffmpeg/index.js', document.baseURI).href;
  var CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
  var WASM_SIZE_HINT = 32232419;
  var MOUNT_DIR = '/input';
  var EPS = 0.002; // 秒。確保 -ss 落在目標關鍵影格之後一點點，-t 停在下一個關鍵影格之前

  function Splitter() {
    this.ffmpeg = null;
    this.loading = null;
  }

  /** 下載並回報進度，回傳 blob URL */
  function fetchToBlobURL(url, mime, onProgress) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('下載失敗：' + url + '（' + res.status + '）');
      var total = Number(res.headers.get('content-length')) || WASM_SIZE_HINT;
      if (!res.body || !onProgress) return res.arrayBuffer();
      var reader = res.body.getReader(), chunks = [], received = 0;
      return (function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(received), off = 0;
            chunks.forEach(function (c) { out.set(c, off); off += c.length; });
            return out.buffer;
          }
          chunks.push(r.value); received += r.value.length;
          onProgress(Math.min(1, received / total));
          return pump();
        });
      })();
    }).then(function (buf) {
      return URL.createObjectURL(new Blob([buf], { type: mime }));
    });
  }

  /** 載入引擎（只會載一次）。onProgress(ratio 0..1) */
  Splitter.prototype.load = function (onProgress) {
    if (this.loading) return this.loading;
    var self = this;
    this.loading = Promise.all([
      import(FFMPEG_MODULE),
      fetchToBlobURL(CORE_BASE + '/ffmpeg-core.wasm', 'application/wasm', onProgress)
    ]).then(function (r) {
      var ffmpeg = new r[0].FFmpeg();
      return ffmpeg.load({ coreURL: CORE_BASE + '/ffmpeg-core.js', wasmURL: r[1] }).then(function () {
        self.ffmpeg = ffmpeg;
        return ffmpeg;
      });
    });
    this.loading.catch(function () { self.loading = null; });
    return this.loading;
  };

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : 'mp4';
  }

  function fmtTime(sec) { return sec.toFixed(6); }

  /** 掛載來源檔（WORKERFS，不複製進記憶體） */
  Splitter.prototype.mount = function (file) {
    var ffmpeg = this.ffmpeg;
    var inputName = 'in.' + extOf(file.name);
    var wrapped = new File([file], inputName, { type: file.type });
    this.inputPath = MOUNT_DIR + '/' + inputName;
    return ffmpeg.createDir(MOUNT_DIR).catch(function () {})
      .then(function () { return ffmpeg.mount('WORKERFS', { files: [wrapped] }, MOUNT_DIR); });
  };

  Splitter.prototype.unmount = function () {
    var ffmpeg = this.ffmpeg;
    if (!ffmpeg) return Promise.resolve();
    return ffmpeg.unmount(MOUNT_DIR).catch(function () {})
      .then(function () { return ffmpeg.deleteDir(MOUNT_DIR).catch(function () {}); });
  };

  /**
   * 切出一段。segment = {start, end}；isLast 時不加 -t。
   * onProgress(ratio) 以已輸出的時間估算。
   * @returns {Promise<Blob>}
   */
  Splitter.prototype.cutSegment = function (segment, isLast, onProgress) {
    var ffmpeg = this.ffmpeg;
    var outName = 'out.mp4';
    var ss = segment.start > 0 ? segment.start + EPS : 0;
    var dur = segment.end - segment.start;
    var args = [];
    if (ss > 0) args.push('-ss', fmtTime(ss));
    args.push('-i', this.inputPath);
    if (!isLast) args.push('-t', fmtTime((segment.end - EPS) - ss));
    args.push('-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', outName);

    var onProg = function (e) {
      if (!onProgress || !dur) return;
      var t = (e.time || 0) / 1e6;
      onProgress(Math.max(0, Math.min(1, t / dur)));
    };
    ffmpeg.on('progress', onProg);

    return ffmpeg.exec(args).then(function (code) {
      ffmpeg.off('progress', onProg);
      if (code !== 0) throw new Error('FFmpeg 回傳錯誤碼 ' + code);
      return ffmpeg.readFile(outName);
    }).then(function (data) {
      return ffmpeg.deleteFile(outName).catch(function () {}).then(function () {
        var blob = new Blob([data], { type: 'video/mp4' });
        data = null;
        return blob;
      });
    }).catch(function (err) {
      ffmpeg.off('progress', onProg);
      throw err;
    });
  };

  root.Splitter = Splitter;
})(self);
