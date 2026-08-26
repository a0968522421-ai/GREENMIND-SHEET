/**
 * GreenMind 果園巡查與智慧農業服務需求調查
 * Google Apps Script 後端 ＋ 前端頁面（同一個專案搞定，不用另外找地方架站）
 *
 * 部署步驟：
 * 1. 開一份新的 Google 試算表（之後回覆會自動寫進來）。
 * 2. 上方選單：擴充功能 → Apps Script，開啟 Apps Script 編輯器。
 * 3. 左側「檔案」旁邊的 + 號 → 指令碼：
 *      - 刪掉預設的 Code.gs 內容，貼上「本檔案」全部內容
 * 4. 左側「檔案」旁邊的 + 號 → HTML：
 *      - 檔名務必取為 Index（大小寫要一致，不要加 .html）
 *      - 把 index.html 那份檔案的全部內容貼進去
 * 5. 右上角「部署」→「新增部署作業」：
 *      - 類型選「網頁應用程式」
 *      - 說明：GreenMind 問卷
 *      - 執行身分：我 (你的帳號，建議用個人 Gmail，不要用機構網域帳號)
 *      - 具有存取權的使用者：任何人
 *    部署後會拿到一組網址，格式類似：
 *      https://script.google.com/macros/s/AKfycb.../exec
 * 6. 這組網址就是可以直接分享給農民的表單連結。
 * 7. 之後每次修改 Code.gs 或 Index.html，記得回到「部署」→「管理部署作業」→
 *    選現有部署 → 版本選「新版本」→ 部署，網址才會套用最新內容。
 * 8. 第一次執行時，Google 會要求你授權腳本存取試算表，照畫面指示同意即可。
 */

// 若要指定特定試算表，可以填入試算表 ID；留空則使用「綁定此腳本的試算表」
const SPREADSHEET_ID = ''; // 例如 '1AbCDefGhIJKLmnoPQRstuVWxyz'
const SHEET_NAME = '問卷回覆';

// 依前端 collectFormData() 輸出的欄位順序，同時也是 Google Sheet 的表頭
const FIELDS = [
  'submitted_at',
  'q1_crops',
  'q2_region',
  'q3_area',
  'q3_plots',
  'q4_manage',
  'q5_freq',
  'q6_duration',
  'q7_observe',
  'q8_tools',
  'q9_pain',
  'q10_threshold',
  'q11_wish',
  'q12_barrier',
  'q13_value',
  'q14_pricing',
  'q15_price',
  'q16_noreason',
  'q17_consent',
  'q17_title',
  'q17_line',
  'q17_phone',
  'q17_email',
  'user_agent',
];

// 每一題必填 / 選填規則（與前端保持一致，後端再驗證一次，避免略過前端直接打 API）
const REQUIRED_FIELDS = [
  'q1_crops','q2_region','q3_area','q3_plots','q4_manage',
  'q5_freq','q6_duration','q7_observe','q8_tools',
  'q9_pain','q10_threshold','q12_barrier','q13_value',
  'q14_pricing','q15_price','q17_consent',
];

/**
 * 網頁應用程式進入點：使用者打開網址時，直接把表單頁面（Index.html）回傳
 */
function doGet(e) {
  return HtmlService
    .createHtmlOutputFromFile('Index')
    .setTitle('果園巡查與智慧農業服務需求調查｜GreenMind')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 表單頁面用 google.script.run 呼叫的送出函式（同一專案內，無需網址、無 CORS 問題）
 */
function submitForm(data) {
  return processSubmission_(data);
}

/**
 * （備用）如果你之後想讓「其他外部網頁」也能送資料進來，
 * 仍保留傳統 POST 端點，行為與 submitForm 完全一致。
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ status: 'error', message: '沒有收到表單資料' });
    }
    const data = JSON.parse(e.postData.contents);
    return jsonResponse(processSubmission_(data));
  } catch (err) {
    return jsonResponse({ status: 'error', message: '伺服器處理發生錯誤：' + err.message });
  }
}

/**
 * 共用的驗證＋寫入邏輯
 */
function processSubmission_(data) {
  // ---- 後端驗證：必填欄位不可為空 ----
  const missing = REQUIRED_FIELDS.filter(f => !data[f] || String(data[f]).trim() === '');
  if (missing.length > 0) {
    return { status: 'error', message: '缺少必填欄位：' + missing.join(', ') };
  }

  // ---- 邊界條件：Q17 選「願意」或「需要再討論細節」時，需至少一種聯絡方式 ----
  if (data.q17_consent === '願意' || data.q17_consent === '需要再討論細節') {
    const hasContact = (data.q17_line && data.q17_line.trim()) ||
                        (data.q17_phone && data.q17_phone.trim()) ||
                        (data.q17_email && data.q17_email.trim());
    if (!hasContact) {
      return { status: 'error', message: '您表示願意／可討論提供資料，請至少留下一種聯絡方式' };
    }
  }

  // ---- 基本格式檢查（避免亂碼/超長字串塞爆表格） ----
  Object.keys(data).forEach(key => {
    if (typeof data[key] === 'string' && data[key].length > 2000) {
      data[key] = data[key].slice(0, 2000) + '…（已截斷）';
    }
  });
  if (data.q17_email && data.q17_email.trim()) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(data.q17_email.trim())) {
      return { status: 'error', message: 'Email 格式看起來不正確，請確認後再送出' };
    }
  }

  appendRow(data);
  return { status: 'ok', message: '已成功寫入' };
}

/**
 * 寫入一列資料到 Google Sheet；若表頭不存在會自動建立
 */
function appendRow(data) {
  const sheet = getSheet_();
  ensureHeader_(sheet);

  const timestamp = data.submitted_at || new Date().toISOString();
  const row = FIELDS.map(field => {
    if (field === 'submitted_at') return formatTimestamp_(timestamp);
    const v = data[field];
    return (v === undefined || v === null) ? '' : String(v);
  });

  sheet.appendRow(row);
}

function ensureHeader_(sheet) {
  const firstCell = sheet.getRange(1, 1).getValue();
  if (firstCell !== FIELDS[0]) {
    sheet.getRange(1, 1, 1, FIELDS.length).setValues([FIELDS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, FIELDS.length).setFontWeight('bold').setBackground('#EFE9DA');
  }
}

function getSheet_() {
  const ss = SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  return sheet;
}

function formatTimestamp_(isoString) {
  try {
    const d = new Date(isoString);
    return Utilities.formatDate(d, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
  } catch (e) {
    return isoString;
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * （選用）在 Apps Script 編輯器內手動執行，快速測試寫入流程
 */
function _test() {
  const sample = {
    submitted_at: new Date().toISOString(),
    q1_crops: '柑橘／桶柑／茂谷柑、棗子',
    q2_region: '新竹縣',
    q3_area: '1–3甲',
    q3_plots: '2–3塊',
    q4_manage: '家庭＋臨時工',
    q5_freq: '每週一次',
    q6_duration: '1–2小時',
    q7_observe: '病蟲害 > 葉片狀況 > 果實狀況',
    q8_tools: '手機拍照、LINE／通訊軟體',
    q9_pain: '人力不足、巡查果園花費太多時間',
    q10_threshold: '累積2–5顆才處理',
    q11_wish: '希望能有人幫忙定期巡查，減少人力負擔。',
    q12_barrier: '價格太高',
    q13_value: '定期幫忙巡查果園 > 產生簡單的果園巡查報告',
    q14_pricing: '每月訂閱',
    q15_price: '1000–2000元/月',
    q16_noreason: '',
    q17_consent: '願意',
    q17_title: '阿明果園',
    q17_line: 'greenmind_test',
    q17_phone: '',
    q17_email: '',
    user_agent: 'test-script',
  };
  appendRow(sample);
}
