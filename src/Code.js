/**
 * AMD News Auto Collector - Google Apps Script (GAS)
 * 專門用於每日全自動抓取 AMD 相關新聞，清洗、去重後存入 Google Sheets
 * 
 * 支援來源:
 * 1. Google News RSS (繁體中文 - 台灣)
 * 2. Google News RSS (英文 - 全球)
 * 3. Yahoo Finance RSS (美股行情與重大新聞)
 * 4. Tom's Hardware RSS (硬體與架構專業報導)
 */

// ==========================================
// 1. 系統組態配置 (APP_CONFIG)
// ==========================================
const APP_CONFIG = {
  SHEET_NAMES: {
    NEWS: 'News_Feed',
    CONFIG: 'System_Config',
    LOGS: 'Execution_Logs'
  },
  DEFAULT_SOURCES: [
    {
      name: 'Google News (TW)',
      url: 'https://news.google.com/rss/search?q=AMD&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
      category: '新聞/綜合',
      lang: 'zh-TW',
      enabled: true
    },
    {
      name: 'Google News (US)',
      url: 'https://news.google.com/rss/search?q=AMD&hl=en-US&gl=US&ceid=US:en',
      category: '新聞/國際',
      lang: 'en-US',
      enabled: true
    },
    {
      name: 'Yahoo Finance (AMD)',
      url: 'https://finance.yahoo.com/rss/headline?s=AMD',
      category: '財經/美股',
      lang: 'en-US',
      enabled: true
    },
    {
      name: "Tom's Hardware (AMD)",
      url: 'https://www.tomshardware.com/feeds/tag/amd',
      category: '科技/硬體',
      lang: 'en-US',
      enabled: true
    }
  ],
  KEYWORDS: ['AMD', 'Ryzen', 'Radeon', 'EPYC', 'Instinct', 'Lisa Su', '蘇姿丰', 'MI300', 'MI325', 'Zen 5', 'Zen 6', 'RDNA'],
  EXCLUDE_WORDS: ['spam', 'casino', 'gambling'],
  BATCH_SIZE_LIMIT: 200,
  TIMEZONE: 'Asia/Taipei',
  MAX_LOG_ROWS: 1000
};

// ==========================================
// 2. 輔助工具函式 (Utils)
// ==========================================
const Utils = {
  /**
   * 計算字串的 MD5 雜湊值 (作為新聞唯一識別碼)
   * @param {string} input 
   * @returns {string} 16 進位 MD5 字串
   */
  generateMD5(input) {
    if (!input) return '';
    const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, input, Utilities.Charset.UTF_8);
    let output = '';
    for (let i = 0; i < rawHash.length; i++) {
      let byteVal = rawHash[i];
      if (byteVal < 0) byteVal += 256;
      let hex = byteVal.toString(16);
      if (hex.length === 1) hex = '0' + hex;
      output += hex;
    }
    return output;
  },

  /**
   * 清除文字中的 HTML 標籤及實體符號
   * @param {string} html 
   * @returns {string} 純文字
   */
  stripHtml(html) {
    if (!html) return '';
    let text = html.replace(/<[^>]+>/g, '');
    text = text
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text;
  },

  /**
   * 格式化日期時間為繁體中文標準字串 (yyyy-MM-dd HH:mm:ss)
   * @param {Date|string} date 
   * @returns {string}
   */
  formatDateTime(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return String(date);
    return Utilities.formatDate(d, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
  },

  /**
   * 格式化純日期 (yyyy-MM-dd)
   * @param {Date|string} date 
   * @returns {string}
   */
  formatDateOnly(date) {
    if (!date) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, APP_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
};

// ==========================================
// 3. 工作表服務 (SheetService)
// ==========================================
class SheetService {
  constructor() {
    this.ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!this.ss) {
      throw new Error('無法取得目前試算表實例，請確認腳本已綁定 Google Sheets。');
    }
  }

  /**
   * 初始化系統所需的所有工作表與表頭樣式
   */
  initializeSheets() {
    this.getOrCreateSheet(APP_CONFIG.SHEET_NAMES.NEWS, [
      '新聞ID (MD5)',
      '發布時間',
      '抓取時間',
      '新聞標題',
      '來源媒體',
      '分類標籤',
      '新聞連結',
      '內容摘要',
      '語言',
      '處理狀態'
    ], '#1e293b', [140, 150, 150, 320, 140, 110, 260, 400, 80, 100]);

    this.getOrCreateSheet(APP_CONFIG.SHEET_NAMES.CONFIG, [
      '設定項 (Key)',
      '設定值 (Value)',
      '說明描述'
    ], '#0f766e', [200, 300, 350]);

    this.getOrCreateSheet(APP_CONFIG.SHEET_NAMES.LOGS, [
      '執行時間',
      '來源名稱',
      '抓取總筆數',
      '新增筆數',
      '重複略過筆數',
      '執行狀態',
      '詳細說明 / 錯誤訊息',
      '耗時 (ms)'
    ], '#374151', [160, 160, 100, 100, 110, 100, 350, 90]);

    this.seedDefaultConfig();
  }

  /**
   * 取得或建立指定名稱工作表
   */
  getOrCreateSheet(sheetName, headers, headerBgColor, colWidths) {
    let sheet = this.ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = this.ss.insertSheet(sheetName);
    }

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground(headerBgColor);
      headerRange.setFontColor('#ffffff');
      headerRange.setFontWeight('bold');
      headerRange.setHorizontalAlignment('center');
      headerRange.setVerticalAlignment('middle');
      sheet.setRowHeight(1, 36);
      sheet.setFrozenRows(1);

      if (colWidths && colWidths.length === headers.length) {
        for (let i = 0; i < colWidths.length; i++) {
          sheet.setColumnWidth(i + 1, colWidths[i]);
        }
      }
    }
    return sheet;
  }

  /**
   * 寫入預設 Config 資料
   */
  seedDefaultConfig() {
    const configSheet = this.ss.getSheetByName(APP_CONFIG.SHEET_NAMES.CONFIG);
    if (configSheet.getLastRow() <= 1) {
      const defaultConfigs = [
        ['ENABLE_EMAIL_NOTIFICATION', 'FALSE', '是否在每日抓取後發送彙整信件 (TRUE/FALSE)'],
        ['NOTIFICATION_EMAIL', Session.getActiveUser().getEmail() || 'admin@example.com', '接收彙整通知的 Email 地址'],
        ['RETENTION_DAYS', '90', '新聞保留天數 (超過自動歸檔或刪除，0 代表永久保留)'],
        ['MIN_KEYWORD_MATCH', 'TRUE', '是否啟動嚴格關鍵字比對過濾 (TRUE/FALSE)']
      ];
      configSheet.getRange(2, 1, defaultConfigs.length, 3).setValues(defaultConfigs);
    }
  }

  /**
   * 取得已存在的全部新聞 ID 集合 (Set)，以供 O(1) 比對去重
   * @returns {Set<string>}
   */
  getExistingNewsIds() {
    const newsSheet = this.ss.getSheetByName(APP_CONFIG.SHEET_NAMES.NEWS);
    if (!newsSheet) return new Set();
    const lastRow = newsSheet.getLastRow();
    if (lastRow <= 1) return new Set();

    const idRange = newsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    const idSet = new Set();
    for (let i = 0; i < idRange.length; i++) {
      const val = idRange[i][0];
      if (val) {
        idSet.add(String(val).trim());
      }
    }
    return idSet;
  }

  /**
   * 批次將新聞寫入 News_Feed 工作表
   * @param {Array<Object>} newsList 
   * @returns {number} 實際寫入筆數
   */
  appendNewsBatch(newsList) {
    if (!newsList || newsList.length === 0) return 0;
    const newsSheet = this.ss.getSheetByName(APP_CONFIG.SHEET_NAMES.NEWS);
    if (!newsSheet) throw new Error('找不到工作表: ' + APP_CONFIG.SHEET_NAMES.NEWS);

    const rows = newsList.map(item => [
      item.id,
      item.publishedAt,
      item.fetchedAt,
      item.title,
      item.source,
      item.category,
      item.url,
      item.snippet,
      item.lang,
      'NEW'
    ]);

    const startRow = newsSheet.getLastRow() + 1;
    newsSheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

    // 設定格式
    const dateRange = newsSheet.getRange(startRow, 2, rows.length, 2);
    dateRange.setHorizontalAlignment('center');

    const linkRange = newsSheet.getRange(startRow, 7, rows.length, 1);
    linkRange.setWrap(false);

    return rows.length;
  }

  /**
   * 記錄執行日誌
   */
  logExecution(sourceName, totalFetched, insertedCount, skippedCount, status, message, elapsedMs) {
    const logSheet = this.ss.getSheetByName(APP_CONFIG.SHEET_NAMES.LOGS);
    if (!logSheet) return;

    const timestamp = Utils.formatDateTime(new Date());
    logSheet.appendRow([
      timestamp,
      sourceName,
      totalFetched,
      insertedCount,
      skippedCount,
      status,
      message,
      elapsedMs
    ]);

    // 檢查若超過 MAX_LOG_ROWS 則自動清理舊日誌
    const totalRows = logSheet.getLastRow();
    if (totalRows > APP_CONFIG.MAX_LOG_ROWS) {
      const deleteCount = totalRows - APP_CONFIG.MAX_LOG_ROWS;
      logSheet.deleteRows(2, deleteCount);
    }
  }

  /**
   * 讀取設定檔數值
   */
  getConfigValue(key, defaultValue = '') {
    const configSheet = this.ss.getSheetByName(APP_CONFIG.SHEET_NAMES.CONFIG);
    if (!configSheet) return defaultValue;
    const lastRow = configSheet.getLastRow();
    if (lastRow <= 1) return defaultValue;

    const values = configSheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < values.length; i++) {
      if (values[i][0] === key) {
        return values[i][1];
      }
    }
    return defaultValue;
  }
}

// ==========================================
// 4. RSS 擷取與 XML 解析器 (RssService)
// ==========================================
class RssService {
  /**
   * 抓取並解析單一 RSS Feed
   * @param {Object} source 來源設定
   * @returns {Array<Object>} 抓取到的標準化新聞清單
   */
  static fetchFeed(source) {
    const response = UrlFetchApp.fetch(source.url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 GAS-NewsCollector'
      }
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      throw new Error(`HTTP 請求失敗 (狀態碼 ${statusCode}) 網址: ${source.url}`);
    }

    const xmlContent = response.getContentText();
    return this.parseXml(xmlContent, source);
  }

  /**
   * 解析 RSS 2.0 或 Atom XML
   * @param {string} xmlText 
   * @param {Object} source 
   * @returns {Array<Object>}
   */
  static parseXml(xmlText, source) {
    const newsItems = [];
    let document;
    try {
      document = XmlService.parse(xmlText);
    } catch (e) {
      // 嘗試清理非標準 XML 控制字元後再次嘗試
      const sanitizedXml = xmlText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
      document = XmlService.parse(sanitizedXml);
    }

    const root = document.getRootElement();
    const nowStr = Utils.formatDateTime(new Date());

    // 處理標準 RSS 2.0 (<rss><channel><item>...</item></channel></rss>)
    const channel = root.getChild('channel');
    if (channel) {
      const items = channel.getChildren('item');
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const titleRaw = item.getChildText('title') || '';
        const title = Utils.stripHtml(titleRaw);
        const link = (item.getChildText('link') || '').trim();
        const guidElem = item.getChild('guid');
        const guid = guidElem ? guidElem.getText().trim() : link;
        const pubDateRaw = item.getChildText('pubDate') || '';
        const descriptionRaw = item.getChildText('description') || '';
        const snippet = Utils.stripHtml(descriptionRaw).slice(0, 500);

        // 媒體來源 (Google News 常有 <source url="...">媒體名稱</source>)
        const sourceElem = item.getChild('source');
        const mediaSource = sourceElem ? sourceElem.getText().trim() : source.name;

        // 計算唯一 ID (以 Link 或 GUID 雜湊)
        const uniqueKey = guid || link || title;
        const id = Utils.generateMD5(uniqueKey);

        if (title && (link || guid)) {
          newsItems.push({
            id: id,
            publishedAt: Utils.formatDateTime(pubDateRaw),
            fetchedAt: nowStr,
            title: title,
            source: mediaSource,
            category: source.category,
            url: link,
            snippet: snippet,
            lang: source.lang
          });
        }
      }
      return newsItems;
    }

    // 處理 Atom Feed (<feed><entry>...</entry></feed>)
    const atomNamespace = root.getNamespace();
    const entries = root.getChildren('entry', atomNamespace);
    if (entries && entries.length > 0) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const title = Utils.stripHtml(entry.getChildText('title', atomNamespace) || '');
        const linkElem = entry.getChild('link', atomNamespace);
        const link = linkElem ? (linkElem.getAttribute('href') ? linkElem.getAttribute('href').getValue() : linkElem.getText()) : '';
        const idRaw = entry.getChildText('id', atomNamespace) || link;
        const publishedRaw = entry.getChildText('published', atomNamespace) || entry.getChildText('updated', atomNamespace) || '';
        const summaryRaw = entry.getChildText('summary', atomNamespace) || entry.getChildText('content', atomNamespace) || '';
        const snippet = Utils.stripHtml(summaryRaw).slice(0, 500);

        const id = Utils.generateMD5(idRaw || link || title);

        if (title && link) {
          newsItems.push({
            id: id,
            publishedAt: Utils.formatDateTime(publishedRaw),
            fetchedAt: nowStr,
            title: title,
            source: source.name,
            category: source.category,
            url: link,
            snippet: snippet,
            lang: source.lang
          });
        }
      }
    }

    return newsItems;
  }
}

// ==========================================
// 5. 新聞過濾與清洗服務 (NewsFilterService)
// ==========================================
class NewsFilterService {
  /**
   * 過濾不相關新聞與廣告垃圾
   * @param {Array<Object>} newsList 
   * @param {boolean} strictKeywordMatch 
   * @returns {Array<Object>}
   */
  static filter(newsList, strictKeywordMatch = true) {
    if (!newsList) return [];

    return newsList.filter(item => {
      const fullText = (item.title + ' ' + item.snippet).toLowerCase();

      // 1. 檢查排除詞 (Blacklist)
      for (let i = 0; i < APP_CONFIG.EXCLUDE_WORDS.length; i++) {
        if (fullText.includes(APP_CONFIG.EXCLUDE_WORDS[i].toLowerCase())) {
          return false;
        }
      }

      // 2. 嚴格關鍵字比對 (至少需包含一個 AMD 相關關鍵字)
      if (strictKeywordMatch) {
        const matched = APP_CONFIG.KEYWORDS.some(kw => fullText.includes(kw.toLowerCase()));
        if (!matched) return false;
      }

      return true;
    });
  }
}

// ==========================================
// 6. 電子郵件通知服務 (NotificationService)
// ==========================================
class NotificationService {
  /**
   * 發送每日新聞彙整 Email
   * @param {Array<Object>} newItems 
   * @param {string} recipientEmail 
   */
  static sendDailyDigest(newItems, recipientEmail) {
    if (!recipientEmail || !newItems || newItems.length === 0) return;

    const todayStr = Utils.formatDateOnly(new Date());
    const subject = `【AMD 新聞情報日報】今日新增 ${newItems.length} 則新聞 (${todayStr})`;

    let htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 20px; color: #333333; line-height: 1.6;">
        <div style="border-bottom: 3px solid #ED1C24; padding-bottom: 12px; margin-bottom: 24px;">
          <h2 style="margin: 0; color: #111827;">🚀 AMD 新聞情報日報</h2>
          <p style="margin: 4px 0 0; color: #6B7280; font-size: 14px;">產出時間: ${Utils.formatDateTime(new Date())} ｜ 本次新增收錄: <strong>${newItems.length}</strong> 則</p>
        </div>
        <div style="margin-bottom: 20px;">
    `;

    newItems.forEach((item, index) => {
      htmlBody += `
        <div style="margin-bottom: 16px; padding: 14px; background: #F9FAFB; border-left: 4px solid #ED1C24; border-radius: 4px;">
          <div style="font-size: 13px; color: #4B5563; margin-bottom: 4px;">
            <span style="background: #E5E7EB; padding: 2px 8px; border-radius: 4px; font-weight: 500;">${item.category}</span>
            <span style="margin-left: 8px;">來源: <strong>${item.source}</strong></span>
            <span style="margin-left: 8px; color: #9CA3AF;">${item.publishedAt}</span>
          </div>
          <a href="${item.url}" target="_blank" style="font-size: 16px; font-weight: bold; color: #1D4ED8; text-decoration: none;">
            ${index + 1}. ${item.title}
          </a>
          ${item.snippet ? `<p style="font-size: 13px; color: #4B5563; margin: 6px 0 0;">${item.snippet}</p>` : ''}
        </div>
      `;
    });

    htmlBody += `
        </div>
        <div style="border-top: 1px solid #E5E7EB; padding-top: 12px; font-size: 12px; color: #9CA3AF; text-align: center;">
          本郵件由 Google Apps Script 全自動排程系統發送。
        </div>
      </div>
    `;

    MailApp.sendEmail({
      to: recipientEmail,
      subject: subject,
      htmlBody: htmlBody
    });
  }
}

// ==========================================
// 7. 定時觸發器管理 (TriggerManager)
// ==========================================
class TriggerManager {
  /**
   * 建立每日定時執行的 Trigger (每天早上 07:00 ~ 08:00 執行)
   */
  static setupDailyTrigger() {
    this.removeTriggers('mainDailyCollectNews');
    ScriptApp.newTrigger('mainDailyCollectNews')
      .timeBased()
      .atHour(7)
      .everyDays(1)
      .inTimezone(APP_CONFIG.TIMEZONE)
      .create();
  }

  /**
   * 移除指定函式名稱的 Trigger
   * @param {string} functionName 
   */
  static removeTriggers(functionName) {
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === functionName) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  }
}

// ==========================================
// 8. 核心執行控制器 (Core Controller)
// ==========================================
class NewsCollectorApp {
  static run() {
    const startTime = Date.now();
    const sheetService = new SheetService();
    sheetService.initializeSheets();

    const existingIdSet = sheetService.getExistingNewsIds();
    const isStrictMatch = sheetService.getConfigValue('MIN_KEYWORD_MATCH', 'TRUE') === 'TRUE';
    const isEmailEnabled = sheetService.getConfigValue('ENABLE_EMAIL_NOTIFICATION', 'FALSE') === 'TRUE';
    const recipientEmail = sheetService.getConfigValue('NOTIFICATION_EMAIL', '');

    let totalFetched = 0;
    let totalInserted = 0;
    let totalSkipped = 0;
    const newlyAddedList = [];

    const sources = APP_CONFIG.DEFAULT_SOURCES.filter(s => s.enabled);

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const srcStartTime = Date.now();

      try {
        const fetchedList = RssService.fetchFeed(src);
        totalFetched += fetchedList.length;

        // 過濾
        const filteredList = NewsFilterService.filter(fetchedList, isStrictMatch);

        // 去重
        const uniqueToInsert = [];
        for (let j = 0; j < filteredList.length; j++) {
          const item = filteredList[j];
          if (!existingIdSet.has(item.id)) {
            existingIdSet.add(item.id);
            uniqueToInsert.push(item);
          } else {
            totalSkipped++;
          }
        }

        // 寫入 Google Sheet
        const insertedCount = sheetService.appendNewsBatch(uniqueToInsert);
        totalInserted += insertedCount;
        uniqueToInsert.forEach(item => newlyAddedList.push(item));

        const srcElapsed = Date.now() - srcStartTime;
        sheetService.logExecution(
          src.name,
          fetchedList.length,
          insertedCount,
          fetchedList.length - insertedCount,
          'SUCCESS',
          `成功擷取並處理。新增: ${insertedCount}，略過: ${fetchedList.length - insertedCount}`,
          srcElapsed
        );
      } catch (err) {
        const srcElapsed = Date.now() - srcStartTime;
        sheetService.logExecution(
          src.name,
          0,
          0,
          0,
          'ERROR',
          err.message || String(err),
          srcElapsed
        );
      }
    }

    // 發送彙整信件
    if (isEmailEnabled && newlyAddedList.length > 0 && recipientEmail) {
      try {
        NotificationService.sendDailyDigest(newlyAddedList, recipientEmail);
      } catch (mailErr) {
        sheetService.logExecution('MailNotification', 0, 0, 0, 'ERROR', 'Email 發送失敗: ' + mailErr.message, 0);
      }
    }

    const totalElapsed = Date.now() - startTime;
    return {
      totalFetched,
      totalInserted,
      totalSkipped,
      elapsedMs: totalElapsed
    };
  }
}

// ==========================================
// 9. 對外提供之入口函式 (Public API for GAS)
// ==========================================

/**
 * 系統初始化入口: 建立各 Sheet 工作表與表頭樣式
 */
function initSystem() {
  const service = new SheetService();
  service.initializeSheets();
  SpreadsheetApp.getActiveSpreadsheet().toast('工作表初始化完成！', 'AMD News Collector', 5);
}

/**
 * 每日排程定時器入口
 */
function mainDailyCollectNews() {
  const result = NewsCollectorApp.run();
  Logger.log(`[完成] 總抓取: ${result.totalFetched}, 新增: ${result.totalInserted}, 耗時: ${result.elapsedMs}ms`);
}

/**
 * 一鍵安裝每日定時 Trigger (每日早上 7~8 點自動抓取)
 */
function setupTrigger() {
  TriggerManager.setupDailyTrigger();
  SpreadsheetApp.getActiveSpreadsheet().toast('已成功建立每日早上 07:00 排程 Trigger！', '觸發器設定', 5);
}

/**
 * 清除所有排程 Trigger
 */
function clearAllTriggers() {
  TriggerManager.removeTriggers('mainDailyCollectNews');
  SpreadsheetApp.getActiveSpreadsheet().toast('已清除所有自動排程 Trigger。', '觸發器清除', 5);
}

/**
 * 手動即刻執行新聞收集測試
 */
function manualRunTest() {
  const result = NewsCollectorApp.run();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `抓取完成！新增 ${result.totalInserted} 則新聞，重複略過 ${result.totalSkipped} 則。`,
    '手動同步結果',
    8
  );
}
