// icp — Apps Script backend для главного кабинета (index.html) + мост в тренажёр.
// ОТДЕЛЬНЫЙ, НОВЫЙ проект — дневник (dnevnik) и калькулятор не трогаем и не используем
// их Apps Script, чтобы не было риска что-то сломать в уже работающем скрипте, код
// которого не виден отсюда для сверки.
//
// Настройка один раз, перед деплоем (Project Settings → Script Properties):
//   STREAMS               = ПОТОК-7            (нужен только один раз: из него создастся лист "streams";
//                                                дальше потоки добавляются строками в листе "streams")
//   TRAINER_BRIDGE_URL    = https://hisngabuakjdwoggkttb.supabase.co/functions/v1/trainer-bridge
//   BRIDGE_SHARED_SECRET  = <длинная случайная строка, придумать один раз и запомнить>
//                           (им же подписываются токены наставников — смена секрета разлогинит всех)
//   DIARY_BRIDGE_URL      = https://zmkbkmjxyqokyzmkqdrg.supabase.co/functions/v1/diary-bridge
//   DIARY_BRIDGE_SECRET   = <тот же, что секрет DIARY_BRIDGE_SECRET в Supabase → Edge Functions → Secrets>
//
// Роли: лист "mentors" (id | name | code | role | active). role = owner или mentor.
// Лист "streams", колонка mentor — id наставников потока через запятую (m1 или m1,m2).
// Владелец видит все потоки, наставник — только свои. Права проверяются на каждом запросе.
// Лист создаётся автоматически; чтобы создать его заранее — запустить setupMentors() в редакторе
// (она же ставит выпадающие списки). Пустой code в mentors заполняется сам (onEdit / fillMentorCodes()).
//
// Аналитика: листы "an_students" и "an_modules" строит buildAnalytics(); раз в час её запускает триггер,
// который ставится один раз вручную — запустить setupAnalyticsTrigger() в редакторе.
//
// Данные хранятся в Google Таблице, к которой привязан этот скрипт
// (Расширения → Apps Script). Два листа создаются автоматически при первом вызове:
// "students" и "answers" — те же поля, что раньше лежали в localStorage (apiMock).

function getProp(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function getSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function studentsSheet() { return getSheet('students', ['uid', 'name', 'stream']); }
function answersSheet()  { return getSheet('answers', ['id', 'uid', 'name', 'stream', 'module', 'qid', 'q', 'type', 'answer', 'correct', 'status', 'comment', 'ts']); }

// Лист "streams" заполняют админ/наставник вручную: code | name | mentor | active.
// При первом создании листа он заполняется из старой настройки STREAMS (чтобы ПОТОК-7 не пропал).
function streamsSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existed = !!ss.getSheetByName('streams');
  const sheet = getSheet('streams', ['code', 'name', 'mentor', 'active']);
  if (!existed) {
    String(getProp('STREAMS') || '').split(',').forEach(function (s) {
      s = s.trim();
      if (s) sheet.appendRow([s, s, '', 'да']);
    });
  }
  return sheet;
}

function mentorsSheet() { return getSheet('mentors', ['id', 'name', 'code', 'role', 'active']); }

// Запустить один раз в редакторе: создаёт листы, ставит выпадающие списки
// (mentors: role, active; streams: active, mentor) и заполняет пустые коды наставников.
function setupMentors() {
  const ms = mentorsSheet();
  const ss = streamsSheet();
  const rows = 1000;
  const list = function (values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  };
  ms.getRange(2, 4, rows, 1).setDataValidation(list(['owner', 'mentor']));
  ms.getRange(2, 5, rows, 1).setDataValidation(list(['да', 'нет']));
  ss.getRange(2, 4, rows, 1).setDataValidation(list(['да', 'нет']));
  // mentor в streams: список id из mentors; допускается ввод "m1,m2" (для двух наставников),
  // поэтому неподходящее значение только подсвечивается предупреждением, а не запрещается.
  const mentorIds = SpreadsheetApp.newDataValidation()
    .requireValueInRange(ms.getRange('A2:A'), true)
    .setAllowInvalid(true)
    .build();
  ss.getRange(2, 3, rows, 1).setDataValidation(mentorIds);
  fillMentorCodes();
}

// Подставляет случайный код в строки mentors, где заполнены id и имя, а code пуст.
// Заполненные коды не трогает; новый код не совпадает с существующими.
function fillMentorCodes() {
  const sheet = mentorsSheet();
  const rows = sheet.getDataRange().getValues();
  const used = {};
  for (let i = 1; i < rows.length; i++) {
    const c = String(rows[i][2]).trim();
    if (c) used[c] = true;
  }
  for (let i = 1; i < rows.length; i++) {
    if (!String(rows[i][0]).trim() || !String(rows[i][1]).trim() || String(rows[i][2]).trim()) continue;
    let code;
    do { code = Utilities.getUuid().replace(/-/g, '').slice(0, 10); } while (used[code]);
    used[code] = true;
    sheet.getRange(i + 1, 3).setValue(code);
  }
}

// Простой триггер: при правке листа mentors сам подставляет код в пустые строки.
function onEdit(e) {
  if (e && e.range && e.range.getSheet().getName() === 'mentors') fillMentorCodes();
}

// ---------- Аналитика по домашке (листы an_students и an_modules, обновляются раз в час) ----------
// Источник — только чтение answers и students. Листы an_* целиком перезаписываются одной записью.
// Тест (type=test): считаем верные по correct. Открытый (type=open): status = pass / fail / pending.

function isTrue(v) { return v === true || String(v).trim().toLowerCase() === 'true'; }

function writeReport(name, headers, data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  const all = [headers].concat(data);
  sheet.getRange(1, 1, all.length, headers.length).setValues(all);
  sheet.setFrozenRows(1);
}

function pct(a, b) { return b ? Math.round(100 * a / b) + '%' : ''; }

function buildAnalytics() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const tz = Session.getScriptTimeZone();
    const sRows = studentsSheet().getDataRange().getValues();
    const aRows = answersSheet().getDataRange().getValues();

    // по ученику
    const byStudent = {};
    for (let i = 1; i < sRows.length; i++) {
      const uid = String(sRows[i][0]);
      if (!uid) continue;
      byStudent[uid] = { stream: String(sRows[i][2]).trim().toUpperCase(), name: sRows[i][1],
        tests: 0, testsOk: 0, open: 0, pass: 0, fail: 0, pending: 0, modules: {}, last: 0 };
    }
    // по потоку+модулю
    const byModule = {};

    for (let i = 1; i < aRows.length; i++) {
      const r = aRows[i];
      const uid = String(r[1]), stream = String(r[3]).trim().toUpperCase(), module = String(r[4]);
      const type = String(r[7]), status = String(r[10]), ts = Number(r[12]) || 0;
      const ok = isTrue(r[9]);
      const st = byStudent[uid] || (byStudent[uid] = { stream: stream, name: r[2],
        tests: 0, testsOk: 0, open: 0, pass: 0, fail: 0, pending: 0, modules: {}, last: 0 });
      const key = stream + '|' + module;
      const md = byModule[key] || (byModule[key] = { stream: stream, module: module, students: {},
        tests: 0, testsOk: 0, open: 0, pass: 0, fail: 0, pending: 0 });

      st.modules[module] = true;
      md.students[uid] = true;
      if (ts > st.last) st.last = ts;
      if (type === 'test') {
        st.tests++; md.tests++;
        if (ok) { st.testsOk++; md.testsOk++; }
      } else {
        st.open++; md.open++;
        if (status === 'pass') { st.pass++; md.pass++; }
        else if (status === 'fail') { st.fail++; md.fail++; }
        else { st.pending++; md.pending++; }
      }
    }

    const studentRows = Object.keys(byStudent).map(function (uid) {
      const s = byStudent[uid];
      return [s.stream, s.name, uid, Object.keys(s.modules).length,
        s.tests, s.testsOk, pct(s.testsOk, s.tests),
        s.open, s.pass, s.fail, s.pending,
        s.last ? Utilities.formatDate(new Date(s.last), tz, 'yyyy-MM-dd HH:mm') : ''];
    }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });

    const moduleRows = Object.keys(byModule).map(function (k) {
      const m = byModule[k];
      return [m.stream, m.module, Object.keys(m.students).length,
        m.tests, m.testsOk, pct(m.testsOk, m.tests),
        m.open, m.pass, m.fail, m.pending, pct(m.pass, m.open)];
    }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])); });

    writeReport('an_students',
      ['поток', 'ученик', 'uid', 'модулей сдано', 'тестов', 'тестов верно', '% тестов',
       'открытых', 'зачёт', 'на доработку', 'ждут проверки', 'последняя отправка'], studentRows);
    writeReport('an_modules',
      ['поток', 'модуль', 'учеников сдали', 'тестов', 'тестов верно', '% тестов',
       'открытых', 'зачёт', 'на доработку', 'ждут проверки', '% зачёта открытых'], moduleRows);
  } finally {
    lock.releaseLock();
  }
}

// Запустить один раз в редакторе: ставит обновление аналитики раз в час (старый триггер заменяется).
function setupAnalyticsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildAnalytics') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildAnalytics').timeBased().everyHours(1).create();
  buildAnalytics();
}

function isOff(v) {
  const a = String(v).trim().toLowerCase();
  return a === 'нет' || a === 'no' || a === 'false' || a === '0';
}

function findMentorByCode(code) {
  code = String(code || '').trim();
  if (!code) return null;
  const rows = mentorsSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]).trim() === code) return mentorFromRow(rows[i]);
  }
  return null;
}

function findMentorById(id) {
  const rows = mentorsSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === id) return mentorFromRow(rows[i]);
  }
  return null;
}

function mentorFromRow(r) {
  const role = String(r[3]).trim().toLowerCase() === 'owner' ? 'owner' : 'mentor';
  return { id: String(r[0]).trim(), name: String(r[1]).trim(), role: role, active: !isOff(r[4]) };
}

// Токен: id.срок.подпись. Без состояния; активность наставника проверяется по листу при каждом запросе.
const TOKEN_TTL_MS = 14 * 24 * 3600 * 1000;
function signToken(id, exp) {
  const sig = Utilities.computeHmacSha256Signature(id + '|' + exp, String(getProp('BRIDGE_SHARED_SECRET') || ''));
  return Utilities.base64EncodeWebSafe(sig);
}
function issueToken(id) {
  const exp = Date.now() + TOKEN_TTL_MS;
  return id + '.' + exp + '.' + signToken(id, exp);
}
function authMentor(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const id = parts[0], exp = Number(parts[1]);
  if (!id || !exp || exp < Date.now()) return null;
  if (signToken(id, exp) !== parts[2]) return null;
  const m = findMentorById(id);
  return m && m.active ? m : null;
}

// Потоки, доступные наставнику: [{code, name}]. Владелец — все.
function streamsFor(m) {
  const rows = streamsSheet().getDataRange().getValues();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const code = String(rows[i][0]).trim().toUpperCase();
    if (!code) continue;
    const ids = String(rows[i][2]).split(',').map(function (x) { return x.trim(); });
    if (m.role === 'owner' || ids.indexOf(m.id) >= 0) out.push({ code: code, name: rows[i][1] });
  }
  return out;
}

function findStream(code) {
  const rows = streamsSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim().toUpperCase() === code) {
      return { code: code, name: rows[i][1], mentor: rows[i][2], active: !isOff(rows[i][3]) };
    }
  }
  return null;
}

function findStudent(stream, name) {
  const rows = studentsSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][2] === stream && String(rows[i][1]).toLowerCase() === name.toLowerCase()) {
      return { uid: rows[i][0], name: rows[i][1], stream: rows[i][2] };
    }
  }
  return null;
}

function createStudent(stream, name) {
  const uid = 'u' + Date.now();
  studentsSheet().appendRow([uid, name, stream]);
  return { uid, name, stream };
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return jsonOut({ ok: false, error: 'invalid json' }); }
  const action = body.action;

  if (action === 'login') return handleLogin(body);
  if (action === 'submit') return handleSubmit(body);
  if (action === 'my') return handleMy(body);
  if (action === 'curator') return handleCurator(body);
  if (action === 'grade') return handleGrade(body);
  if (action === 'bridge') return handleBridge(body);
  if (action === 'diary_bridge') return handleDiaryBridge(body);
  return jsonOut({ ok: false, error: 'unknown action' });
}

function handleLogin(p) {
  const m = findMentorByCode(p.stream);
  if (m) {
    if (!m.active) return jsonOut({ ok: false, error: 'Доступ отключён. Напиши владельцу.' });
    return jsonOut({ ok: true, role: m.role, name: m.name, token: issueToken(m.id) });
  }

  const stream = String(p.stream || '').trim().toUpperCase();
  const name = String(p.name || '').trim();
  if (!stream || !name) return jsonOut({ ok: false, error: 'Заполни код потока и имя.' });

  const st = findStream(stream);
  if (!st) {
    return jsonOut({ ok: false, error: 'Такого потока нет. Проверь код — его давал куратор.' });
  }
  if (!st.active) {
    return jsonOut({ ok: false, error: 'Этот поток закрыт. Напиши куратору.' });
  }

  let s = findStudent(stream, name);
  if (!s) s = createStudent(stream, name);
  return jsonOut({ ok: true, role: 'student', uid: s.uid, name: s.name, stream: s.stream });
}

function handleSubmit(p) {
  // отправки идут по очереди: параллельные «удалить старое + дописать новое» давали дубли строк
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return submitLocked(p); } finally { lock.releaseLock(); }
}

function submitLocked(p) {
  const uid = p.uid, name = p.name, stream = p.stream, module = p.module, items = p.items || [];
  const sheet = answersSheet();
  const rows = sheet.getDataRange().getValues();
  // старые ответы этого ученика по этому модулю — удаляем снизу вверх, чтобы номера строк не сдвигались
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][1] === uid && rows[i][4] === module) sheet.deleteRow(i + 1);
  }
  // одной записью, а не appendRow на каждый ответ — иначе отправка теста тормозит
  const newRows = items.map(function (it, k) {
    return ['a' + Date.now() + k + Math.round(Math.random() * 1000), uid, name, stream, module,
      it.qid, it.q, it.type, it.answer, it.correct, it.status || '', '', Date.now()];
  });
  if (newRows.length) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
  return jsonOut({ ok: true });
}

function handleMy(p) {
  const rows = answersSheet().getDataRange().getValues();
  const headers = rows[0];
  const answers = rows.slice(1).filter(function (r) { return r[1] === p.uid; }).map(function (r) { return rowToObj(headers, r); });
  return jsonOut({ ok: true, answers: answers });
}

function handleCurator(p) {
  const m = authMentor(p.token);
  if (!m) return jsonOut({ ok: false, error: 'auth' });
  const streams = streamsFor(m);
  const allowed = streams.map(function (x) { return x.code; });

  const sRows = studentsSheet().getDataRange().getValues();
  const sHeaders = sRows[0];
  const students = sRows.slice(1).map(function (r) { return rowToObj(sHeaders, r); })
    .filter(function (s) { return allowed.indexOf(String(s.stream).trim().toUpperCase()) >= 0; });

  const aRows = answersSheet().getDataRange().getValues();
  const aHeaders = aRows[0];
  const answers = aRows.slice(1).map(function (r) { return rowToObj(aHeaders, r); })
    .filter(function (a) { return allowed.indexOf(String(a.stream).trim().toUpperCase()) >= 0; });

  return jsonOut({ ok: true, role: m.role, streams: streams, students: students, answers: answers });
}

function handleGrade(p) {
  const m = authMentor(p.token);
  if (!m) return jsonOut({ ok: false, error: 'auth' });
  const allowed = streamsFor(m).map(function (x) { return x.code; });
  const sheet = answersSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.id) {
      if (allowed.indexOf(String(rows[i][3]).trim().toUpperCase()) < 0) return jsonOut({ ok: false, error: 'forbidden' });
      sheet.getRange(i + 1, 11).setValue(p.status);              // status
      sheet.getRange(i + 1, 12).setValue(p.comment || '');       // comment
      sheet.getRange(i + 1, 10).setValue(p.status === 'pass');   // correct
      break;
    }
  }
  return jsonOut({ ok: true });
}

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach(function (h, i) { obj[h] = row[i]; });
  return obj;
}

// Мост в тренажёр: секрет остаётся здесь, на сервере, никогда не уходит в браузер студента.
function handleBridge(p) {
  const stream = String(p.stream || '').trim().toUpperCase();
  const name = String(p.name || '').trim();
  if (!stream || !name) return jsonOut({ ok: false, error: 'stream and name required' });

  const url = getProp('TRAINER_BRIDGE_URL');
  const secret = getProp('BRIDGE_SHARED_SECRET');
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ action: 'issue', secret: secret, stream: stream, name: name }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(resp.getContentText());
  return jsonOut(data);
}

// Мост в дневник (R-Дневник): та же схема, но свой секрет и своя Edge Function.
function handleDiaryBridge(p) {
  const stream = String(p.stream || '').trim().toUpperCase();
  const name = String(p.name || '').trim();
  if (!stream || !name) return jsonOut({ ok: false, error: 'stream and name required' });

  const url = getProp('DIARY_BRIDGE_URL');
  const secret = getProp('DIARY_BRIDGE_SECRET');
  if (!url || !secret) return jsonOut({ ok: false, error: 'diary bridge not configured' });
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ action: 'issue', secret: secret, stream: stream, name: name }),
    muteHttpExceptions: true,
  });
  let data;
  try { data = JSON.parse(resp.getContentText()); } catch (err) { data = { ok: false, error: 'bad response from diary bridge' }; }
  return jsonOut(data);
}

// ── Удаление учеников сразу везде ───────────────────────────────────────────
// Меню "Кабинет → Удалить выбранных учеников": выделить строки на листе "students"
// и нажать пункт меню. Ученик удаляется в дневнике и в тренажёре (по потоку и имени),
// затем строка убирается из таблицы. Если в одной из баз удаление не удалось,
// строка остаётся — повторите после исправления. Листы answers / an_students не трогаются.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Кабинет')
    .addItem('Удалить выбранных учеников', 'deleteSelectedStudents')
    .addToUi();
}

function callDeleteBridge(urlProp, secretProp, stream, name) {
  const url = getProp(urlProp);
  const secret = getProp(secretProp);
  if (!url || !secret) return { ok: false, error: urlProp + ' не настроен' };
  try {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ action: 'delete', secret: secret, stream: stream, name: name }),
      muteHttpExceptions: true,
    });
    return JSON.parse(resp.getContentText());
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function deleteSelectedStudents() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'students') {
    ui.alert('Откройте лист "students" и выделите строки учеников.');
    return;
  }
  const range = sheet.getActiveRange();
  const first = Math.max(range.getRow(), 2);   // строку 1 (заголовки) не трогаем
  const last = range.getLastRow();
  if (last < first) { ui.alert('Выделите строки учеников (не заголовок).'); return; }

  const rows = sheet.getRange(first, 1, last - first + 1, 3).getValues();
  const list = [];
  rows.forEach(function (r, i) {
    const name = String(r[1] || '').trim();
    const stream = String(r[2] || '').trim().toUpperCase();
    if (name && stream) list.push({ row: first + i, name: name, stream: stream });
  });
  if (!list.length) { ui.alert('В выделенных строках нет учеников.'); return; }

  const names = list.map(function (s) { return s.name + ' (' + s.stream + ')'; }).join('\n');
  const answer = ui.alert(
    'Удалить ' + list.length + ' учеников из дневника, тренажёра и таблицы?\nЭто необратимо.',
    names, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  const failed = [];
  const removeRows = [];
  list.forEach(function (s) {
    const d = callDeleteBridge('DIARY_BRIDGE_URL', 'DIARY_BRIDGE_SECRET', s.stream, s.name);
    const t = callDeleteBridge('TRAINER_BRIDGE_URL', 'BRIDGE_SHARED_SECRET', s.stream, s.name);
    if (d.ok && t.ok) removeRows.push(s.row);
    else failed.push(s.name + ': дневник — ' + (d.ok ? 'ок' : d.error) + '; тренажёр — ' + (t.ok ? 'ок' : t.error));
  });
  removeRows.sort(function (a, b) { return b - a; })   // снизу вверх, чтобы номера не сдвигались
    .forEach(function (r) { sheet.deleteRow(r); });

  ui.alert('Удалено: ' + removeRows.length + ' из ' + list.length +
    (failed.length ? '\n\nНе удалось (строки оставлены):\n' + failed.join('\n') : ''));
}
