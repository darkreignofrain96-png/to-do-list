const APP_NAME = 'To do List';
const APP_STATE_SHEET = 'AppState';
const SHEET_NAMES = ['Tasks', 'FocusTasks', 'Routines', 'RoutineLog', 'Projects', 'DailyReview'];

function doGet(e) {
  const action = (e.parameter.action || 'ping').toLowerCase();
  const callback = e.parameter.callback || '';

  try {
    if (action === 'load') return respond_({ ok: true, ...loadData_() }, callback);
    if (action === 'ping') return respond_(ping_(), callback);
    return respond_({ ok: false, error: 'Unknown action: ' + action }, callback);
  } catch (error) {
    return respond_({ ok: false, error: String(error && error.message ? error.message : error) }, callback);
  }
}

function doPost(e) {
  try {
    const payload = parsePost_(e);
    if ((payload.action || '').toLowerCase() !== 'save') {
      throw new Error('Unsupported action.');
    }

    saveData_(payload);
    return respond_({
      ok: true,
      savedAt: new Date().toISOString(),
      spreadsheetId: getSpreadsheet_().getId(),
      spreadsheetName: getSpreadsheet_().getName(),
    });
  } catch (error) {
    return respond_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function ping_() {
  const spreadsheet = getSpreadsheet_();
  return {
    ok: true,
    app: APP_NAME,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    checkedAt: new Date().toISOString(),
  };
}

function saveData_(payload) {
  const spreadsheet = getSpreadsheet_();
  const sheets = payload.sheets || {};

  SHEET_NAMES.forEach((name) => {
    writeSheet_(spreadsheet, name, sheets[name] || [[]]);
  });

  writeAppState_(spreadsheet, payload.state || {}, payload.savedAt || new Date().toISOString());
}

function loadData_() {
  const spreadsheet = getSpreadsheet_();
  const state = readAppState_(spreadsheet);
  const sheets = {};

  SHEET_NAMES.forEach((name) => {
    sheets[name] = readSheet_(spreadsheet, name);
  });

  return {
    state,
    sheets,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    loadedAt: new Date().toISOString(),
  };
}

function writeSheet_(spreadsheet, name, rows) {
  const sheet = getOrCreateSheet_(spreadsheet, name);
  sheet.clearContents();

  if (!rows || !rows.length || !rows[0].length) {
    sheet.getRange(1, 1).setValue('');
    return;
  }

  const normalized = normalizeRows_(rows);
  sheet.getRange(1, 1, normalized.length, normalized[0].length).setValues(normalized);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, normalized[0].length);
}

function writeAppState_(spreadsheet, state, savedAt) {
  const sheet = getOrCreateSheet_(spreadsheet, APP_STATE_SHEET);
  sheet.clearContents();
  sheet.getRange(1, 1, 4, 2).setValues([
    ['Key', 'Value'],
    ['App', APP_NAME],
    ['Saved At', savedAt],
    ['State JSON', JSON.stringify(state || {})],
  ]);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 2);
}

function readAppState_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(APP_STATE_SHEET);
  if (!sheet) return null;

  const values = sheet.getDataRange().getValues();
  const stateRow = values.find((row) => row[0] === 'State JSON');
  if (!stateRow || !stateRow[1]) return null;
  return JSON.parse(String(stateRow[1]));
}

function readSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) return [];
  return sheet.getDataRange().getValues();
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty('SPREADSHEET_ID');
  if (storedId) return SpreadsheetApp.openById(storedId);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    props.setProperty('SPREADSHEET_ID', active.getId());
    return active;
  }

  const created = SpreadsheetApp.create(APP_NAME + ' データ');
  props.setProperty('SPREADSHEET_ID', created.getId());
  return created;
}

function getOrCreateSheet_(spreadsheet, name) {
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function normalizeRows_(rows) {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return rows.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push('');
    return next.map((value) => (value === undefined || value === null ? '' : value));
  });
}

function parsePost_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function respond_(data, callback) {
  const json = JSON.stringify(data);
  const output = callback ? callback + '(' + json + ');' : json;
  const mimeType = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(output).setMimeType(mimeType);
}
