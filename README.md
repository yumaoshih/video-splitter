# 影片切割（線上版）

把大影片切成指定大小的 MP4，全部在瀏覽器裡完成：不上傳、不重新編碼、不需要安裝任何軟體。

## 運作方式

1. 用 [mp4box.js](https://github.com/gpac/mp4box.js) 只讀取影片的索引（moov），依封包順序累加大小，在最近的關鍵影格算出切割點。727MB 的影片只需讀 1.6MB 就能算完。
2. 用 [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) 以 `-c copy` 逐段切出 MP4，一次只處理一段，記憶體壓力小。
3. 每段切好就自動下載。

## 檔案結構

```
index.html          頁面
css/style.css       樣式（Vercel 風格 token，支援深色模式）
js/split-plan.js    由索引計算切割點（純函式，Node 也能用）
js/mp4-index.js     以 mp4box.js 漸進讀取索引
js/splitter.js      ffmpeg.wasm 包裝：載入、掛載、逐段切割
js/app.js           頁面互動
vendor/ffmpeg/      @ffmpeg/ffmpeg 0.12.15 的 ESM 版（worker 必須同源，故自行託管）
```

ffmpeg 核心（約 32MB 的 wasm）與 mp4box.js 由 CDN 載入，版本已鎖定。

## 本機預覽

任何靜態伺服器皆可，例如：

```bash
python3 -m http.server 8765
```

再開啟 http://localhost:8765 。直接雙擊 index.html（file://）無法使用，因為 worker 需要 http 來源。

## 部署

整個資料夾就是靜態網站，放到 GitHub Pages、Cloudflare Pages、Netlify 或任何靜態主機即可，不需要後端。

## 限制

- 支援 MP4 / MOV（ISOBMFF 容器）。MKV、AVI 等不支援。
- 建議使用電腦版 Chrome、Edge 或 Firefox。手機瀏覽器記憶體有限，大檔案不可靠。
- 單段大小上限 10 到 4000 MB。若某個關鍵影格區間本身就大於上限（極少見），該段會超過上限並在畫面上標示。
- 每段尾端會多帶約一個音訊封包（約 20 毫秒），屬正常現象。
