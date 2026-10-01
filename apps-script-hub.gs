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
//
// Роли: лист "mentors" (id | name | code | role | active). role = owner или mentor.
// Лист "streams", колонка mentor — id наставников потока через запятую (m1 или m1,m2).
// Владелец видит все потоки, наставник — только свои. Права проверяются на каждом запросе.
// Лист создаётся автоматически; чтобы создать его заранее — запустить setupMentors() в редакторе.
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
function setupMentors() { mentorsSheet(); }

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
