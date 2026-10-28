# AMD 新聞自動收集與監控系統 (GAS + Google Sheets)

- **作者 GitHub**: [https://github.com/linuxfab](https://github.com/linuxfab)
- **最後更新時間**: 2026-10-29 00:15:00 (Asia/Taipei)
- **維護者**: linuxfab (linuxfab@gmail.com)

---

## 1. 系統架構概要

本專案為 100% 雲端無伺服器 (Serverless) 架構的新聞情報自動爬取與匯整系統，基於 **Google Apps Script (GAS, V8 Runtime)** 與 **Google Sheets** 打造。無需架設任何 VPS 或資料庫伺服器，直接利用 Google 雲端排程定時抓取、解析、清洗與去重 AMD 相關新聞。

```
[ 多來源 RSS 資料源 ]
  ├── Google News TW (繁中/台灣)
  ├── Google News US (英文/全球)
  ├── Yahoo Finance (美股/財報)
  └── Tom's Hardware (硬體/架構評測)
          │
          ▼ [UrlFetchApp]
[ GAS 核心處理引擎 (src/Code.js) ]
  ├── 1. XmlService DOM 解析 (支援 RSS 2.0 & Atom)
  ├── 2. MD5 唯一特徵值計算 (GUID / URL Hash)
  ├── 3. 關鍵字加權與黑名單過濾 (Ryzen, Radeon, EPYC, MI300...)
  ├── 4. Set O(1) 記憶體快速去重比對
  └── 5. 批次寫入 (Batch Append)
          │
          ├──▶ [Google Sheets 資料庫] (News_Feed, System_Config, Execution_Logs)
          └──▶ [MailApp / Gmail] (每日 HTML 彙整郵件通知，選用)
```

---

## 2. 資料庫結構 (Google Sheets Schema)

本系統使用單一 Google Spreadsheet 內的 3 個主要工作表作為資料儲存與配置管理庫：

### 2.1 工作表: `News_Feed` (新聞主資料表)

| 欄位序號 | 欄位名稱 | 型態 | 索引/鍵 | 範例與說明 |
|---|---|---|---|---|
| A | `新聞ID (MD5)` | VARCHAR(32) | Primary Key (唯一鍵) | `9a8f3b2c1d4e...` (由 GUID 或 Link 雜湊而成) |
| B | `發布時間` | DATETIME | Index | `2026-10-28 22:30:00` |
| C | `抓取時間` | DATETIME | - | `2026-10-29 07:00:15` |
| D | `新聞標題` | VARCHAR(500) | - | AMD Announces Next-Gen Instinct MI325X GPU |
| E | `來源媒體` | VARCHAR(100) | - | Bloomberg / 工商時報 / Tom's Hardware |
| F | `分類標籤` | VARCHAR(50) | - | `科技/硬體`, `財經/美股`, `新聞/綜合` |
| G | `新聞連結` | TEXT (URL) | - | `https://news.google.com/rss/articles/...` |
| H | `內容摘要` | TEXT | - | 新聞內文前 500 字清洗純文字摘要 |
| I | `語言` | VARCHAR(10) | - | `zh-TW` / `en-US` |
| J | `處理狀態` | VARCHAR(20) | - | `NEW` (預設) / `READ` / `ARCHIVED` |

### 2.2 工作表: `System_Config` (系統組態檔)

| 欄位序號 | 欄位名稱 | 型態 | 說明 |
|---|---|---|---|
| A | `設定項 (Key)` | VARCHAR(50) | `ENABLE_EMAIL_NOTIFICATION`, `NOTIFICATION_EMAIL`, `RETENTION_DAYS`, `MIN_KEYWORD_MATCH` |
| B | `設定值 (Value)` | TEXT | `TRUE`, `linuxfab@gmail.com`, `90`, `TRUE` |
| C | `說明描述` | TEXT | 設定用途備註 |

### 2.3 工作表: `Execution_Logs` (系統執行日誌)

| 欄位序號 | 欄位名稱 | 型態 | 說明 |
|---|---|---|---|
| A | `執行時間` | DATETIME | 執行當下時間戳記 |
| B | `來源名稱` | VARCHAR(100) | `Google News (TW)`, `Yahoo Finance` 等 |
| C | `抓取總筆數` | INT | RSS 取得之原始新聞項目數 |
| D | `新增筆數` | INT | 通過過濾且未重複的新增項目數 |
| E | `重複略過筆數`| INT | 已存在於資料庫而忽略的筆數 |
| F | `執行狀態` | VARCHAR(20) | `SUCCESS` / `ERROR` |
| G | `詳細說明` | TEXT | 錯誤堆疊或執行統計訊息 |
| H | `耗時 (ms)` | INT | 該次擷取耗費毫秒數 |

---

## 3. 安裝與部署指南

1. **建立 Google Sheets 試算表**:
   - 瀏覽器開啟 Google Sheets，建立空白試算表，命名為 `AMD 新聞收集庫`。
2. **開啟 Apps Script 編輯器**:
   - 點選上方工具列：`擴充功能 (Extensions)` -> `Apps Script`。
3. **部署程式碼**:
   - 將專案中 `src/Code.js` 的完整原始碼複製並覆蓋編輯器內的 `Code.gs`。
   - 點選儲存 (Ctrl + S)。
4. **初次授權與初始化**:
   - 於上方函式下拉選單選擇 `initSystem` 並點選「執行」。
   - Google 會跳出權限確認提示，點選進階並允許存取 (試算表讀寫與網路抓取權限)。
   - 執行完成後，Google Sheets 將自動建立三個工作表並完成美化表頭格式。
5. **啟動每日定時自動排程**:
   - 於函式選單選擇 `setupTrigger` 並執行。
   - 系統將於每日清晨 07:00 ~ 08:00 自動觸發 `mainDailyCollectNews` 執行同步。

---

## 4. 模組架構說明

- **`APP_CONFIG`**: 集中管理 RSS Feed URL、關鍵字過濾白名單、黑名單、時區及限制筆數。
- **`SheetService`**: 封裝 SpreadsheetApp 的批次操作，提供記憶體比對加速 (利用 JavaScript `Set` 達成 $O(1)$ 查找去重)。
- **`RssService`**: 整合 `XmlService`，自動相容 RSS 2.0 與 Atom XML 結構，並執行 HTML 標籤淨化。
- **`NewsFilterService`**: 進行多維度關鍵字加權檢驗，過濾垃圾廣告與非 AMD 主題文章。
- **`NotificationService`**: 格式化產生 RWD HTML 郵件摘要，便於手機或信箱即時查閱。
- **`TriggerManager`**: 自動化註冊與銷毀 Apps Script Time-driven Triggers。
