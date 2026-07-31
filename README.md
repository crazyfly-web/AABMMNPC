# Big7 Portfolio

極簡的個人投資組合網站：7 檔美股 + 10% 現金、持股成本、目前權重、損益、再平衡輸入與永久 Log。

## 為什麼使用 Workers + D1

交易 Log 需要由網頁寫入並永久保存；GitHub 靜態 JSON 無法安全地被瀏覽器直接改寫。Cloudflare 官方目前也建議新專案使用 Workers Static Assets，並可在同一個 Worker 使用 D1 與 Cron Trigger。

## 內建初始資料

- NVDA：5 股，成本 980.98 USD
- MSFT：5 股，成本 2,242.14 USD
- AVGO：0 股
- GOOGL：13 股，成本 4,248.24 USD
- AMZN：6 股，成本 1,423.42 USD
- META：5 股，成本 2,866.86 USD
- PLTR：10 股，成本 1,212.41 USD
- 現金：部署後在網站按「直接設定現金餘額」輸入

目標權重：NVDA 18%、MSFT 16%、AVGO 14%、GOOGL 14%、AMZN 10%、META 10%、PLTR 8%、現金 10%。

## 部署步驟

### 1. 建立 GitHub repository

把本資料夾全部上傳到新的 repository。

### 2. 在 Mac 終端機安裝依賴

```bash
npm install
npx wrangler login
```

### 3. 建立 D1

```bash
npx wrangler d1 create big7-portfolio-db
```

Cloudflare 會回傳 `database_id`。將它貼進 `wrangler.jsonc`，取代：

```text
REPLACE_WITH_YOUR_D1_DATABASE_ID
```

### 4. 建立資料表與初始持倉

```bash
npm run db:remote
```

### 5. 設定管理密碼

```bash
npx wrangler secret put ADMIN_TOKEN
```

請輸入只有自己知道的長密碼。網站不會將密碼永久儲存在伺服器或 GitHub；瀏覽器只會在目前分頁工作階段保存。

### 6. 部署

```bash
npm run deploy
```

完成後 Wrangler 會顯示 `workers.dev` 網址。

## GitHub 自動部署（選用）

在 Cloudflare Dashboard 建立 Worker 並連接 GitHub repository：

- Build command：`npm run deploy`
- Deploy command：`npx wrangler deploy`

最穩定的初次部署方式仍是先在終端機完成上述 1–6 步。

## 每日更新時間

`wrangler.jsonc` 使用：

```json
"crons": ["30 22 * * *"]
```

Cloudflare Cron 採 UTC，因此 22:30 UTC = 台灣次日 06:30。Worker 會抓取最近一個有效美股收盤價並存入 D1。

## 本機測試

```bash
npm run db:local
npm run dev
```

瀏覽器開啟 Wrangler 顯示的本機網址。測試排程：

```bash
curl "http://localhost:8787/__scheduled?cron=30+22+*+*+*"
```

## 使用方式

1. 部署後先按「更新股價」。
2. 按「直接設定現金餘額」，輸入尚未投入的美元現金。
3. 再平衡時輸入買進或賣出：日期、股票、股數、交易總額、備註。
4. 買進會增加股數與成本並扣除現金；賣出採平均成本法減少剩餘成本並增加現金。
5. 所有操作自動寫入 Rebalance Log。

## 注意

Yahoo Finance 並未提供正式保證的免費公開 API。本專案只在每日排程或手動更新時抓取七檔資料，頻率很低；若來源日後改變，僅需替換 `src/index.js` 的 `fetchYahooQuote()`。
