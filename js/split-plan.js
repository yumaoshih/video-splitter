/*
 * 由 MP4/MOV 的 moov 索引計算切割點（不需讀整個檔案）。
 * 依封包在檔案內的順序累加大小，一旦即將超過上限，就在「最近一個視訊關鍵影格」切開。
 * 可同時在瀏覽器（全域 computeSplitPlan）與 Node（module.exports）使用。
 */
(function (root) {
  'use strict';

  var DEFAULT_SAFETY = 0.97; // 預留 3% 給 MP4 容器索引

  function editListOffset(trak) {
    var entries = trak.edts && trak.edts.elst && trak.edts.elst.entries;
    if (!entries) return 0;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].media_time >= 0) return entries[i].media_time;
    }
    return 0;
  }

  function collectSamples(mp4) {
    var info = mp4.getInfo();
    var videoIds = {};
    info.videoTracks.forEach(function (t) { videoIds[t.id] = true; });
    if (!info.videoTracks.length) throw new Error('找不到視訊軌');

    var all = [];
    info.tracks.forEach(function (t) {
      var trak = mp4.getTrackById(t.id);
      var timescale = trak.mdia.mdhd.timescale;
      var offset = editListOffset(trak);
      var isVideo = !!videoIds[t.id];
      trak.samples.forEach(function (s) {
        all.push({
          offset: s.offset,
          size: s.size,
          key: isVideo && !!s.is_sync,
          time: (s.cts - offset) / timescale
        });
      });
    });
    all.sort(function (a, b) { return a.offset - b.offset; });
    return { samples: all, duration: info.duration / info.timescale };
  }

  /**
   * @param {object} mp4  mp4box ISOFile（onReady 之後）
   * @param {number} maxBytes  每段上限（bytes）
   * @param {number} [safety]  安全係數，預設 0.97
   * @returns {{segments: Array<{start:number,end:number,bytes:number}>, duration:number, totalBytes:number}}
   */
  function computeSplitPlan(mp4, maxBytes, safety) {
    var limit = maxBytes * (safety || DEFAULT_SAFETY);
    var data = collectSamples(mp4);
    var cum = 0, splitCum = 0, lastKey = null;
    var cuts = []; // {time, cum}

    data.samples.forEach(function (s) {
      if (s.key) lastKey = { time: s.time, cum: cum };
      cum += s.size;
      if (cum - splitCum > limit && lastKey && lastKey.cum > splitCum) {
        cuts.push(lastKey);
        splitCum = lastKey.cum;
      }
    });

    var segments = [];
    var prevTime = 0, prevCum = 0;
    cuts.forEach(function (c) {
      segments.push({ start: prevTime, end: c.time, bytes: c.cum - prevCum });
      prevTime = c.time; prevCum = c.cum;
    });
    segments.push({ start: prevTime, end: data.duration, bytes: cum - prevCum });

    return { segments: segments, duration: data.duration, totalBytes: cum };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { computeSplitPlan: computeSplitPlan };
  else root.computeSplitPlan = computeSplitPlan;
})(typeof self !== 'undefined' ? self : this);
