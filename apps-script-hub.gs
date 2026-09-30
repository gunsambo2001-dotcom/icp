// icp — Apps Script backend для главного кабинета (index.html) + мост в тренажёр.
// ОТДЕЛЬНЫЙ, НОВЫЙ проект — дневник (dnevnik) и калькулятор не трогаем и не используем
// их Apps Script, чтобы не было риска что-то сломать в уже работающем скрипте, код
// которого не виден отсюда для сверки.
//
// Настройка один раз, перед деплоем (Project Settings → Script Properties):
//   CURATOR_CODE          = kurator-icp-2026   (тот же код, что сейчас в index.html)
//   STREAMS               = ПОТОК-7            (через запятую, если потоков станет больше)
//   TRAINER_BRIDGE_URL    = https://hisngabuakjdwoggkttb.supabase.co/functions/v1/trainer-bridge
//   BRIDGE_SHARED_SECRET  = <длинная случайная строка, придумать один раз и запомнить>
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
  if (action === 'curator') return handleCurator();
  if (action === 'grade') return handleGrade(body);
  if (action === 'bridge') return handleBridge(body);
  return jsonOut({ ok: false, error: 'unknown action' });
}

function handleLogin(p) {
  const stream = String(p.stream || '').trim().toUpperCase();
  const name = String(p.name || '').trim();
  if (!stream || !name) return jsonOut({ ok: false, error: 'Заполни код потока и имя.' });

  const curatorCode = getProp('CURATOR_CODE');
  if (stream === String(curatorCode || '').toUpperCase()) {
    return jsonOut({ ok: true, role: 'curator', name: name });
  }

  const streams = String(getProp('STREAMS') || '').split(',').map(function (s) { return s.trim().toUpperCase(); }).filter(Boolean);
  if (streams.indexOf(stream) < 0) {
    return jsonOut({ ok: false, error: 'Такого потока нет. Проверь код — его давал куратор.' });
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
  items.forEach(function (it) {
    sheet.appendRow(['a' + Date.now() + Math.round(Math.random() * 1000), uid, name, stream, module,
      it.qid, it.q, it.type, it.answer, it.correct, it.status || '', '', Date.now()]);
  });
  return jsonOut({ ok: true });
}

function handleMy(p) {
  const rows = answersSheet().getDataRange().getValues();
  const headers = rows[0];
  const answers = rows.slice(1).filter(function (r) { return r[1] === p.uid; }).map(function (r) { return rowToObj(headers, r); });
  return jsonOut({ ok: true, answers: answers });
}

function handleCurator() {
  const sRows = studentsSheet().getDataRange().getValues();
  const sHeaders = sRows[0];
  const students = sRows.slice(1).map(function (r) { return rowToObj(sHeaders, r); });

  const aRows = answersSheet().getDataRange().getValues();
  const aHeaders = aRows[0];
  const answers = aRows.slice(1).map(function (r) { return rowToObj(aHeaders, r); });

  return jsonOut({ ok: true, students: students, answers: answers });
}

function handleGrade(p) {
  const sheet = answersSheet();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === p.id) {
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
