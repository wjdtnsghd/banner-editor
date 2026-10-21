/**
 * 영업노트 — 팀 공용 가망건 관리 웹앱 (Google Apps Script)
 *
 * 설치: 스프레드시트 → 확장 프로그램 → Apps Script 에 이 파일(Code.gs)과 Index.html 을 붙여넣고
 *       웹 앱으로 배포 (실행 사용자: 웹 앱에 액세스하는 사용자 / 액세스: 도메인 내 모든 사용자)
 */

// ===== 설정 =====
var DAILY_GOAL = 5;                 // 하루 저장 목표(도장 개수)
var COMPANY_NAME = '엠피인터랙티브';  // 기본 템플릿에 들어가는 회사명
var SPREADSHEET_ID = '';            // 비워 두면 이 스크립트가 붙어 있는 시트를 사용

// ===== 시트 구조 =====
var SHEETS = {
  leads: {
    name: '가망건',
    cols: [
      ['id', 'ID'], ['createdAt', '등록일시'], ['ownerEmail', '영업자이메일'], ['ownerName', '영업자'],
      ['company', '업체명'], ['contact', '담당자'], ['phone', '연락처'], ['email', '이메일'],
      ['industry', '업종'], ['grade', '가망도'], ['status', '상태'], ['nextDate', '다음연락일'],
      ['memo', '메모'], ['lastContact', '최근연락일'], ['updatedAt', '수정일시']
    ]
  },
  logs: {
    name: '연락이력',
    cols: [
      ['id', 'ID'], ['leadId', '가망건ID'], ['company', '업체명'], ['at', '일시'],
      ['userEmail', '영업자이메일'], ['userName', '영업자'], ['type', '방식'],
      ['content', '내용'], ['nextDate', '다음연락일']
    ]
  },
  templates: {
    name: '템플릿',
    cols: [['type', '유형'], ['name', '이름'], ['subject', '제목'], ['body', '본문']]
  },
  users: {
    name: '사용자',
    cols: [['email', '이메일'], ['name', '이름'], ['createdAt', '등록일시']]
  }
};

var STATUSES = ['신규', '연락중', '제안발송', '미팅', '계약', '보류', '종료'];
var GRADES = ['상', '중', '하'];

function defaultTemplates_() {
  var c = COMPANY_NAME;
  return [
    ['이메일', '통화 후 인사 + 자료 전달', '[' + c + '] {업체명} 광고 운영 관련 자료 보내드립니다',
      '{담당자}님 안녕하세요,\n' + c + ' {영업자}입니다.\n\n오늘 시간 내어 통화해 주셔서 감사합니다.\n말씀드린 내용 정리해서 자료로 보내드립니다.\n\n감사합니다.\n{영업자} 드림'],
    ['이메일', '제안서 발송', '[' + c + '] {업체명} 맞춤 광고 제안서',
      '{담당자}님 안녕하세요,\n' + c + ' {영업자}입니다.\n\n{업체명}에 맞춰 준비한 광고 제안서를 첨부드립니다.\n검토해 보시고 궁금하신 점은 편하게 연락 주세요.\n\n감사합니다.\n{영업자} 드림'],
    ['이메일', '재연락 (팔로업)', '[' + c + '] 지난번 보내드린 자료 관련 연락드립니다',
      '{담당자}님 안녕하세요,\n' + c + ' {영업자}입니다.\n\n지난번 보내드린 자료는 검토해 보셨는지 궁금해 연락드렸습니다.\n편하신 시간에 짧게 통화 가능하실까요?\n\n감사합니다.\n{영업자} 드림'],
    ['카톡', '통화 후 인사',  '',
      '{담당자}님 안녕하세요, 방금 통화드린 ' + c + ' {영업자}입니다.\n말씀드린 자료는 메일로 보내드렸습니다. 확인 부탁드립니다!'],
    ['카톡', '자료 확인 요청', '',
      '{담당자}님 안녕하세요, ' + c + ' {영업자}입니다.\n보내드린 {업체명} 광고 자료 확인해 보셨을까요? 궁금하신 점 있으면 편하게 말씀 주세요!'],
    ['카톡', '미팅 일정 확인', '',
      '{담당자}님 안녕하세요, ' + c + ' {영업자}입니다.\n{업체명} 광고 관련해서 직접 찾아뵙고 설명드리고 싶은데, 이번 주 편하신 시간이 있으실까요?']
  ];
}

// ===== 웹 앱 진입점 =====
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('영업노트')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ===== 클라이언트에서 호출하는 함수 =====

/** 처음 화면에 필요한 모든 데이터. 시트가 없으면 만든다(설치 확인용으로 편집기에서 실행해도 됨). */
function getInitialData() {
  ensureSheets_();
  var email = currentEmail_();
  var users = readAll_('users');
  var me = null;
  users.forEach(function (u) { if (u.email === email) me = u; });
  return {
    me: { email: email, name: me ? me.name : '' },
    users: users.map(function (u) { return { email: u.email, name: u.name }; }),
    leads: readAll_('leads'),
    templates: readAll_('templates').filter(function (t) { return t.name && t.body; }),
    goal: DAILY_GOAL,
    today: today_(),
    quota: remainingQuota_(),
    statuses: STATUSES,
    grades: GRADES
  };
}

/** 내 이름 저장(처음 접속 또는 이름 변경) */
function saveMyName(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('이름을 입력하세요.');
  var email = currentEmail_();
  return withLock_(function () {
    var rows = readAll_('users');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].email === email) {
        writeRow_('users', rows[i]._row, { email: email, name: name, createdAt: rows[i].createdAt });
        renameOwner_(email, name);
        return { email: email, name: name };
      }
    }
    appendRow_('users', { email: email, name: name, createdAt: now_() });
    return { email: email, name: name };
  });
}

/** 가망건 저장(신규 또는 수정). 저장된 가망건을 돌려준다. */
function saveLead(input) {
  var company = String(input.company || '').trim();
  if (!company) throw new Error('업체명을 입력하세요.');
  var me = currentUser_();
  var lead = {
    company: company,
    contact: clean_(input.contact),
    phone: clean_(input.phone),
    email: clean_(input.email),
    industry: clean_(input.industry),
    grade: GRADES.indexOf(input.grade) >= 0 ? input.grade : '중',
    status: STATUSES.indexOf(input.status) >= 0 ? input.status : '신규',
    nextDate: normDate_(input.nextDate),
    memo: String(input.memo || '').trim(),
    updatedAt: now_()
  };
  return withLock_(function () {
    if (input.id) {
      var found = findById_('leads', input.id);
      if (!found) throw new Error('가망건을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.');
      var merged = Object.assign({}, found, lead);
      writeRow_('leads', found._row, merged);
      delete merged._row;
      return merged;
    }
    lead.id = newId_();
    lead.createdAt = now_();
    lead.ownerEmail = me.email;
    lead.ownerName = me.name;
    lead.lastContact = '';
    appendRow_('leads', lead);
    return lead;
  });
}

/** 상태만 빠르게 변경 */
function setLeadStatus(leadId, status) {
  if (STATUSES.indexOf(status) < 0) throw new Error('알 수 없는 상태입니다.');
  return withLock_(function () {
    var found = findById_('leads', leadId);
    if (!found) throw new Error('가망건을 찾을 수 없습니다.');
    found.status = status;
    found.updatedAt = now_();
    writeRow_('leads', found._row, found);
    delete found._row;
    return found;
  });
}

/** 업체별 연락 기록(최신순) */
function getLogs(leadId) {
  return readAll_('logs')
    .filter(function (l) { return l.leadId === leadId; })
    .map(function (l) { delete l._row; return l; })
    .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
}

/**
 * 연락 기록 추가. type: 통화/전화/카톡/문자/이메일/메모
 * nextDate 를 주면 가망건의 다음 연락일도 바꾼다. 업데이트된 가망건을 돌려준다.
 */
function addLog(leadId, type, content, nextDate) {
  var me = currentUser_();
  return withLock_(function () {
    return addLogNoLock_(leadId, type, content, nextDate, me);
  });
}

/**
 * 선택한 업체마다 한 통씩 이메일 발송(내 Gmail).
 * payload: { ids:[], subject, body, attachments:[{name, mimeType, data(base64)}] }
 */
function sendEmails(payload) {
  var me = currentUser_();
  var subjectT = String(payload.subject || '').trim();
  var bodyT = String(payload.body || '');
  if (!subjectT) throw new Error('제목을 입력하세요.');
  if (!bodyT.trim()) throw new Error('내용을 입력하세요.');

  var blobs = (payload.attachments || []).map(function (a) {
    return Utilities.newBlob(Utilities.base64Decode(a.data), a.mimeType || 'application/octet-stream', a.name);
  });

  var leads = readAll_('leads');
  var byId = {};
  leads.forEach(function (l) { byId[l.id] = l; });

  var targets = (payload.ids || []).map(function (id) { return byId[id]; })
    .filter(function (l) { return l && l.email; });
  if (!targets.length) throw new Error('이메일 주소가 있는 업체가 없습니다.');

  var quota = remainingQuota_();
  if (quota !== null && quota < targets.length) {
    throw new Error('오늘 남은 발송 가능 건수(' + quota + '통)보다 많습니다. 나눠서 보내세요.');
  }

  var results = [];
  targets.forEach(function (lead) {
    var subject = fill_(subjectT, lead, me.name);
    var body = fill_(bodyT, lead, me.name);
    try {
      var opts = { name: me.name ? me.name + ' (' + COMPANY_NAME + ')' : COMPANY_NAME, htmlBody: textToHtml_(body) };
      if (blobs.length) opts.attachments = blobs;
      GmailApp.sendEmail(lead.email, subject, body, opts);
      results.push({ id: lead.id, company: lead.company, ok: true });
    } catch (e) {
      results.push({ id: lead.id, company: lead.company, ok: false, error: String(e.message || e) });
    }
  });

  var updated = withLock_(function () {
    return results.filter(function (r) { return r.ok; }).map(function (r) {
      var lead = byId[r.id];
      var note = '[메일] ' + fill_(subjectT, lead, me.name) + (blobs.length ? ' (첨부 ' + blobs.length + '개)' : '');
      return addLogNoLock_(r.id, '이메일', note, '', me);
    });
  });

  return { results: results, leads: updated, quota: remainingQuota_() };
}

// ===== 내부 함수 =====

function addLogNoLock_(leadId, type, content, nextDate, me) {
  var lead = findById_('leads', leadId);
  if (!lead) throw new Error('가망건을 찾을 수 없습니다.');
  var at = now_();
  nextDate = normDate_(nextDate);
  appendRow_('logs', {
    id: newId_(), leadId: leadId, company: lead.company, at: at,
    userEmail: me.email, userName: me.name, type: type || '메모',
    content: String(content || '').trim(), nextDate: nextDate
  });
  lead.lastContact = at.slice(0, 10);
  if (nextDate) lead.nextDate = nextDate;
  if (type === '이메일' && lead.status === '신규') lead.status = '연락중';
  lead.updatedAt = at;
  writeRow_('leads', lead._row, lead);
  delete lead._row;
  return lead;
}

function renameOwner_(email, name) {
  var rows = readAll_('leads');
  rows.forEach(function (r) {
    if (r.ownerEmail === email && r.ownerName !== name) {
      r.ownerName = name;
      writeRow_('leads', r._row, r);
    }
  });
}

function currentEmail_() {
  var email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  if (!email) throw new Error('구글 계정 정보를 확인할 수 없습니다. 회사 계정으로 로그인했는지 확인하세요.');
  return email.toLowerCase();
}

function currentUser_() {
  var email = currentEmail_();
  var name = '';
  readAll_('users').forEach(function (u) { if (u.email === email) name = u.name; });
  return { email: email, name: name || email.split('@')[0] };
}

function fill_(text, lead, myName) {
  return String(text)
    .replace(/\{업체명\}/g, lead.company || '')
    .replace(/\{담당자\}/g, lead.contact || '담당자')
    .replace(/\{영업자\}/g, myName || '');
}

function textToHtml_(text) {
  var esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div style="font-family:\'맑은 고딕\',\'Malgun Gothic\',sans-serif;font-size:14px;line-height:1.7;color:#222">' +
    esc.replace(/\r?\n/g, '<br>') + '</div>';
}

function remainingQuota_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (e) { return null; }
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('다른 사람이 저장 중입니다. 잠시 후 다시 시도하세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function ss_() {
  return SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(key) {
  return ss_().getSheetByName(SHEETS[key].name);
}

function ensureSheets_() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (key) {
    var def = SHEETS[key];
    var sh = ss.getSheetByName(def.name);
    if (sh) return;
    sh = ss.insertSheet(def.name);
    var headers = def.cols.map(function (c) { return c[1]; });
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#e3efee');
    sh.setFrozenRows(1);
    // 날짜·연락처가 자동 변환되지 않도록 전체를 텍스트 서식으로
    sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
    if (key === 'templates') {
      var rows = defaultTemplates_();
      sh.getRange(2, 1, rows.length, 4).setValues(rows);
      sh.setColumnWidth(3, 320);
      sh.setColumnWidth(4, 480);
    }
  });
  var first = ss.getSheets()[0];
  if (first.getName().match(/^(시트1|Sheet1)$/) && first.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(first);
  }
}

/** 시트 전체를 [{key:value, _row}] 로 읽는다. 머리글 이름으로 열을 찾으므로 열 순서가 바뀌어도 동작. */
function readAll_(key) {
  var sh = sheet_(key);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = sh.getLastColumn();
  var values = sh.getRange(1, 1, last, width).getValues();
  var idx = headerIndex_(key, values[0]);
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue;
    var obj = { _row: r + 1 };
    SHEETS[key].cols.forEach(function (c) {
      var i = idx[c[0]];
      obj[c[0]] = i === undefined ? '' : cell_(row[i], c[0]);
    });
    out.push(obj);
  }
  return out;
}

function headerIndex_(key, headerRow) {
  var idx = {};
  SHEETS[key].cols.forEach(function (c) {
    var i = headerRow.indexOf(c[1]);
    if (i >= 0) idx[c[0]] = i;
  });
  return idx;
}

function cell_(v, field) {
  var tz = Session.getScriptTimeZone();
  if (v instanceof Date) {
    var dateOnly = /Date$|^lastContact$/.test(field);
    return Utilities.formatDate(v, tz, dateOnly ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
  if (field === 'email' || field === 'ownerEmail' || field === 'userEmail') return String(v).trim().toLowerCase();
  return v === null ? '' : String(v);
}

function writeRow_(key, rowNum, obj) {
  var sh = sheet_(key);
  var width = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, width).getValues()[0];
  var current = sh.getRange(rowNum, 1, 1, width).getValues()[0];
  var idx = headerIndex_(key, header);
  SHEETS[key].cols.forEach(function (c) {
    if (idx[c[0]] !== undefined && obj[c[0]] !== undefined) current[idx[c[0]]] = obj[c[0]];
  });
  sh.getRange(rowNum, 1, 1, width).setNumberFormat('@').setValues([current]);
}

function appendRow_(key, obj) {
  var sh = sheet_(key);
  var width = sh.getLastColumn();
  var header = sh.getRange(1, 1, 1, width).getValues()[0];
  var idx = headerIndex_(key, header);
  var row = header.map(function () { return ''; });
  SHEETS[key].cols.forEach(function (c) {
    if (idx[c[0]] !== undefined && obj[c[0]] !== undefined) row[idx[c[0]]] = obj[c[0]];
  });
  var rowNum = sh.getLastRow() + 1;
  sh.getRange(rowNum, 1, 1, width).setNumberFormat('@').setValues([row]);
}

function findById_(key, id) {
  var rows = readAll_(key);
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

function newId_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss') +
    '-' + Utilities.getUuid().slice(0, 6);
}

function now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function today_() {
  return now_().slice(0, 10);
}

function normDate_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var m = String(v).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function clean_(v) {
  return String(v || '').trim();
}
