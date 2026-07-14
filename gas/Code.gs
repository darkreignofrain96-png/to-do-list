const APP_NAME = 'To do List';
const APP_STATE_SHEET = 'AppState';
const SHEET_NAMES = ['Tasks', 'FocusTasks', 'Routines', 'RoutineLog', 'RoutineProgress', 'Projects', 'DailyReview'];

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
  sheets.RoutineProgress = hasDataRows_(sheets.RoutineProgress)
    ? sheets.RoutineProgress
    : buildRoutineProgressSheet_(payload);

  SHEET_NAMES.forEach((name) => {
    writeSheet_(spreadsheet, name, sheets[name] || [[]]);
  });

  writeAppState_(spreadsheet, payload.state || {}, payload.savedAt || new Date().toISOString());
}

function hasDataRows_(rows) {
  return Array.isArray(rows) && rows.length > 1 && Array.isArray(rows[0]) && rows[0].length;
}

function buildRoutineProgressSheet_(payload) {
  const state = payload.state || {};
  const sheets = payload.sheets || {};
  const baseDate = normalizeDate_(state.selectedDate) || todayIso_();
  const routines = Array.isArray(state.routines) && state.routines.length
    ? state.routines
    : routinesFromRows_(sheets.Routines || []);
  const routineLog = state.routineLog && typeof state.routineLog === 'object'
    ? state.routineLog
    : routineLogFromRows_(sheets.RoutineLog || []);

  const sorted = routines.slice().sort((a, b) => {
    const orderA = Number(a.order || 0);
    const orderB = Number(b.order || 0);
    if (orderA !== orderB) return orderA - orderB;
    return String(a.title || '').localeCompare(String(b.title || ''), 'ja');
  });

  return [
    ['基準日', 'Routine ID', '日課', '領域', '見積分', '現在連続日数', '最長連続日数', '直近7日', '直近30日', '合計達成日数', '直近14日完了日', '直近14日状態'],
    ...sorted.map((routine) => {
      const stats = routineStats_(String(routine.id || ''), baseDate, routineLog);
      const recentDates = dateWindow_(baseDate, 14);
      const doneDates = recentDates.filter((date) => isRoutineDone_(routineLog, routine.id, date));
      const recentStatus = recentDates.map((date) => date + ':' + (isRoutineDone_(routineLog, routine.id, date) ? '完了' : '未完了')).join(' / ');
      return [
        baseDate,
        routine.id || '',
        routine.title || '',
        routine.area || '',
        routine.estimateMinutes || 0,
        stats.currentStreak,
        stats.bestStreak,
        stats.done7 + ' / 7',
        stats.done30 + ' / 30',
        stats.totalDone,
        doneDates.join(';'),
        recentStatus,
      ];
    }),
  ];
}

function routinesFromRows_(rows) {
  return objectsFromRows_(rows)
    .filter((row) => row['Routine ID'] || row['日課'])
    .map((row, index) => ({
      id: String(row['Routine ID'] || ''),
      title: String(row['日課'] || ''),
      area: String(row['領域'] || ''),
      estimateMinutes: Number(row['見積分'] || 0),
      order: Number(row['並び順'] || index),
    }));
}

function routineLogFromRows_(rows) {
  const log = {};
  objectsFromRows_(rows).forEach((row) => {
    const date = normalizeDate_(row['日付']);
    const routineId = String(row['Routine ID'] || '');
    if (!date || !routineId) return;
    if (!log[date]) log[date] = {};
    log[date][routineId] = String(row['ステータス'] || '完了');
  });
  return log;
}

function objectsFromRows_(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const headers = rows[0].map((cell) => String(cell || '').trim());
  return rows.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index];
    });
    return object;
  });
}

function routineStats_(routineId, baseDate, routineLog) {
  const doneDates = routineDoneDates_(routineId, routineLog);
  return {
    currentStreak: currentStreak_(routineId, baseDate, routineLog),
    bestStreak: bestStreak_(doneDates),
    done7: countDoneInWindow_(routineId, baseDate, 7, routineLog),
    done30: countDoneInWindow_(routineId, baseDate, 30, routineLog),
    totalDone: doneDates.length,
  };
}

function routineDoneDates_(routineId, routineLog) {
  return Object.keys(routineLog || {})
    .filter((date) => normalizeDate_(date) && isRoutineDone_(routineLog, routineId, date))
    .sort();
}

function currentStreak_(routineId, baseDate, routineLog) {
  let cursor = baseDate;
  let count = 0;
  while (isRoutineDone_(routineLog, routineId, cursor)) {
    count += 1;
    cursor = addDaysIso_(cursor, -1);
  }
  return count;
}

function bestStreak_(doneDates) {
  let best = 0;
  let run = 0;
  let previous = '';
  doneDates.forEach((date) => {
    run = previous && date === addDaysIso_(previous, 1) ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  });
  return best;
}

function countDoneInWindow_(routineId, baseDate, days, routineLog) {
  return dateWindow_(baseDate, days).filter((date) => isRoutineDone_(routineLog, routineId, date)).length;
}

function dateWindow_(baseDate, days) {
  return Array.from({ length: days }, (_, index) => addDaysIso_(baseDate, index - days + 1));
}

function isRoutineDone_(routineLog, routineId, date) {
  return Boolean(routineLog && routineLog[date] && routineLog[date][routineId] === '完了');
}

function addDaysIso_(isoDate, days) {
  const parts = String(isoDate || '').split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function todayIso_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizeDate_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return '';
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
