/**
 * سجل الدرجات — كود الشيت (Google Apps Script)
 * كل فصل = تاب لوحده. كل أسبوع = 12 عمود:
 * د1 ك حصة | د1 ك واجب | د2 ك حصة | د2 ك واجب | د3 ك حصة | د3 ك واجب |
 * متوسط ك حصة | متوسط ك واجب | تقييم أسبوعي | سلوك ومواظبة | المجموع | متوسط تراكمي
 * وفي آخر الجدول 5 أعمدة لاختبارات التيرم:
 * الشهر الأول /15 | الشهر الثاني /15 | متوسط الشهرين /15 | متوسط الأسابيع /25 | المجموع /40
 * المتوسطات والمجموع معادلات جوه الشيت (بتتحسب لوحدها).
 */
const TOKEN = 'hana-math-2027';
const W = 12, OLD_W = 11, HDR = 2, FIRST_COL = 3;
const SUB = ['د1 ك حصة','د1 ك واجب','د2 ك حصة','د2 ك واجب','د3 ك حصة','د3 ك واجب','متوسط ك حصة','متوسط ك واجب','تقييم أسبوعي /10','سلوك ومواظبة /5','المجموع /25','متوسط تراكمي /25'];
const CUM = 'متوسط تراكمي /25';
const T = 5, TSUB = ['الشهر الأول /15','الشهر الثاني /15','متوسط الشهرين /15','متوسط الأسابيع /25','المجموع /40'];
const COLORS = ['#e8f5e9','#e3f2fd'];

function doGet() { return out({ ok: true, msg: 'grades api' }); }

// شغّل الدالة دي مرة واحدة من المحرر عشان جوجل يطلب إذن Drive (لقراءة الصور)
function authorize() {
  DriveApp.getRootFolder();
  UrlFetchApp.fetch('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest', { muteHttpExceptions: true });
}

// قراءة صورة بقارئ جوجل (OCR): بنرفعها كمستند جوجل مؤقت وناخد النص ونمسحه
function ocrImage(b64, mime) {
  const token = ScriptApp.getOAuthToken();
  const boundary = 'grd' + Date.now();
  const meta = JSON.stringify({ name: 'ocr-tmp-' + Date.now(), mimeType: 'application/vnd.google-apps.document' });
  const head = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: ' + (mime || 'image/jpeg') + '\r\n\r\n';
  const tail = '\r\n--' + boundary + '--';
  const payload = Utilities.newBlob(head).getBytes()
    .concat(Utilities.base64Decode(b64))
    .concat(Utilities.newBlob(tail).getBytes());
  const up = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=ar', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary, payload: payload,
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  if (up.getResponseCode() >= 300) throw new Error('قارئ جوجل رفض الصورة: ' + up.getContentText().slice(0, 150));
  const id = JSON.parse(up.getContentText()).id;
  try {
    const ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
    });
    return ex.getContentText('UTF-8');
  } finally {
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.token !== TOKEN) return out({ ok: false, error: 'bad token' });
    const f = ACTIONS[b.action];
    if (!f) return out({ ok: false, error: 'unknown action' });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return out(Object.assign({ ok: true }, f(ss, b) || {}));
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// «غ» = غياب: بيتكتب نص في الشيت، والمعادلات بتتجاهله
function cellVal(x) { if (x === '' || x === null || x === undefined) return ''; if (String(x).trim() === 'غ') return 'غ'; const n = Number(x); return isNaN(n) ? '' : n; }

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function isClass(sh) { return sh.getRange(HDR, 1, 1, 2).getDisplayValues()[0].join('|') === 'م|الاسم'; }
function tabName(n) { return String(n).trim().replace(/[\\\/\?\*\[\]:]/g, '-'); }
function getSh(ss, name) {
  const sh = ss.getSheetByName(tabName(name));
  if (!sh || !isClass(sh)) throw new Error('الفصل مش موجود: ' + name);
  upgrade(sh);
  if (!hasTerm(sh)) addTerm(sh);
  return sh;
}
function nStudents(sh) { return Math.max(0, sh.getLastRow() - HDR); }
function hasTerm(sh) { return sh.getRange(HDR, sh.getLastColumn()).getDisplayValue() === TSUB[4]; }
function nWeeks(sh) { return Math.max(0, Math.floor((sh.getLastColumn() - 2 - (hasTerm(sh) ? T : 0)) / W)); }
function termCol(sh) { return startCol(nWeeks(sh)); }
function startCol(k) { return FIRST_COL + k * W; }

function setFormulas(sh, row, count, k) {
  if (count <= 0) return;
  const s = startCol(k);
  // المتوسط من الدروس اللي اتحطلها درجة بس، مقرّب لرقم عشري واحد
  const avg = '=IF(COUNT(RC[-6],RC[-4],RC[-2])=0,"",ROUND(AVERAGE(RC[-6],RC[-4],RC[-2]),1))';
  sh.getRange(row, s + 6, count, 2).setFormulaR1C1(avg);
  sh.getRange(row, s + 10, count, 1).setFormulaR1C1('=IF(COUNT(RC[-4]:RC[-1])=0,"",ROUND(SUM(RC[-4]:RC[-1]),1))');
}

// المتوسط التراكمي: متوسط مجموع الأسبوع ده واللي قبله (الأسابيع اللي فيها درجات بس)
function cumFormula(k) {
  const refs = [];
  for (let j = 0; j <= k; j++) refs.push('RC[' + (-1 - j * W) + ']');
  const r = refs.join(',');
  return '=IF(COUNT(' + r + ')=0,"",ROUND(AVERAGE(' + r + '),1))';
}
function rewriteCum(sh) {
  const n = nStudents(sh), k = nWeeks(sh);
  for (let i = 0; i < k; i++) {
    sh.getRange(HDR, startCol(i) + 11).setValue(CUM);
    if (n) sh.getRange(HDR + 1, startCol(i) + 11, n, 1).setFormulaR1C1(cumFormula(i));
  }
  if (hasTerm(sh)) termFormulas(sh);
}
// معادلات التيرم: متوسط الأسابيع = آخر متوسط تراكمي
function termFormulas(sh) {
  const n = nStudents(sh), k = nWeeks(sh), s = startCol(k);
  if (!n) return;
  sh.getRange(HDR + 1, s + 2, n, 1).setFormulaR1C1('=IF(COUNT(RC[-2],RC[-1])=0,"",ROUND(AVERAGE(RC[-2],RC[-1]),1))');
  if (k) sh.getRange(HDR + 1, s + 3, n, 1).setFormulaR1C1('=RC[-4]');
  else sh.getRange(HDR + 1, s + 3, n, 1).setValue('');
  sh.getRange(HDR + 1, s + 4, n, 1).setFormulaR1C1('=IF(COUNT(RC[-2],RC[-1])=0,"",ROUND(SUM(RC[-2],RC[-1]),1))');
  sh.getRange(HDR + 1, s, n, T).setHorizontalAlignment('center');
  sh.getRange(HDR + 1, s + 4, n, 1).setFontWeight('bold').setFontColor('#1a237e');
}
function addTerm(sh) {
  const s = sh.getLastColumn() + 1;
  if (sh.getMaxColumns() < s + T - 1) sh.insertColumnsAfter(sh.getMaxColumns(), s + T - 1 - sh.getMaxColumns());
  sh.getRange(1, s, HDR, T).getMergedRanges().forEach(r => r.breakApart());
  sh.getRange(1, s, 1, T).merge().setValue('🏁 اختبارات التيرم').setFontWeight('bold').setHorizontalAlignment('center').setBackground('#9fa8da');
  sh.getRange(HDR, s, 1, T).setValues([TSUB]).setFontWeight('bold').setWrap(true).setHorizontalAlignment('center').setVerticalAlignment('middle').setBackground('#e8eaf6');
  sh.getRange(HDR, s + 4).setBackground('#c5cae9');
  for (let c = s; c < s + T; c++) sh.setColumnWidth(c, 70);
  termFormulas(sh);
}
// ترقية الشيت القديم (11 عمود للأسبوع) للشكل الجديد (12 عمود)
function upgrade(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < FIRST_COL + OLD_W - 1) return;
  if (sh.getRange(HDR, FIRST_COL + 11).getDisplayValue() === CUM) return;
  if (sh.getRange(HDR, FIRST_COL + 10).getDisplayValue() !== 'المجموع /25') return;
  const k = Math.floor((lastCol - 2) / OLD_W);
  for (let i = k - 1; i >= 0; i--) {
    const after = FIRST_COL + i * OLD_W + 10;
    sh.insertColumnAfter(after);
    sh.getRange(1, FIRST_COL + i * OLD_W, 1, OLD_W).breakApart();
  }
  for (let i = 0; i < k; i++) {
    const s = startCol(i);
    const label = sh.getRange(1, s).getDisplayValue();
    sh.getRange(1, s, 1, W).merge().setValue(label);
    styleCum(sh, i);
  }
  rewriteCum(sh);
}
function styleCum(sh, k) {
  const c = startCol(k) + 11, n = nStudents(sh);
  sh.setColumnWidth(c, 70);
  sh.getRange(HDR, c).setBackground('#ffcc80').setFontWeight('bold').setWrap(true).setHorizontalAlignment('center');
  if (n) sh.getRange(HDR + 1, c, n, 1).setHorizontalAlignment('center').setFontWeight('bold').setFontColor('#bf360c');
}

// الطلاب المضافين متأخر (بيتحفظوا بالاسم لكل فصل)
function getLate(cls) { try { return JSON.parse(PropertiesService.getDocumentProperties().getProperty('late_' + tabName(cls)) || '[]'); } catch (e) { return []; } }
function setLate(cls, arr) { PropertiesService.getDocumentProperties().setProperty('late_' + tabName(cls), JSON.stringify(arr)); }

// نوع الطالب (ولد b / بنت g) — بيتحفظ بالاسم لكل فصل
function getGender(cls) { try { return JSON.parse(PropertiesService.getDocumentProperties().getProperty('gender_' + tabName(cls)) || '{}'); } catch (e) { return {}; } }
function setGender(cls, obj) { PropertiesService.getDocumentProperties().setProperty('gender_' + tabName(cls), JSON.stringify(obj)); }
function normName(t) { return String(t).replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim(); }

function renumber(sh) {
  const n = nStudents(sh);
  if (n) sh.getRange(HDR + 1, 1, n, 1).setValues(Array.from({ length: n }, (_, i) => [i + 1]));
}

function findRow(sh, row, name) {
  const n = nStudents(sh);
  const names = n ? sh.getRange(HDR + 1, 2, n, 1).getDisplayValues().map(r => r[0]) : [];
  if (names[row] === name) return HDR + 1 + row;
  const i = names.indexOf(name);
  if (i < 0) throw new Error('الطالب مش موجود: ' + name);
  return HDR + 1 + i;
}

const ACTIONS = {
  ping: () => ({}),

  ocr: (ss, b) => ({ text: ocrImage(String(b.img || ''), b.mime) }),

  classes: (ss) => ({ classes: ss.getSheets().filter(isClass).map(s => s.getName()) }),

  addClass: (ss, b) => {
    const name = tabName(b.name);
    if (!name) throw new Error('اكتب اسم الفصل');
    if (ss.getSheetByName(name)) throw new Error('فيه فصل بنفس الاسم');
    const sh = ss.insertSheet(name);
    sh.setRightToLeft(true);
    sh.getRange(1, 1, 1, 2).merge().setValue('📘 فصل ' + name).setFontWeight('bold').setHorizontalAlignment('center');
    sh.getRange(HDR, 1, 1, 2).setValues([['م', 'الاسم']]).setFontWeight('bold').setBackground('#cfd8dc');
    sh.setColumnWidth(1, 35); sh.setColumnWidth(2, 230);
    sh.setFrozenRows(HDR); sh.setFrozenColumns(2);
    const names = (b.names || []).map(String).filter(Boolean);
    if (names.length) sh.getRange(HDR + 1, 1, names.length, 2).setValues(names.map((n, i) => [i + 1, n]));
    if (sh.getMaxColumns() > 2) sh.deleteColumns(3, sh.getMaxColumns() - 2);
    return { cls: name };
  },

  renameClass: (ss, b) => {
    const sh = ss.getSheetByName(tabName(b.cls));
    if (!sh || !isClass(sh)) throw new Error('الفصل مش موجود');
    const name = tabName(b.name);
    if (!name) throw new Error('اكتب اسم الفصل');
    if (name !== sh.getName() && ss.getSheetByName(name)) throw new Error('فيه فصل بنفس الاسم');
    const late = getLate(b.cls);
    sh.setName(name);
    PropertiesService.getDocumentProperties().deleteProperty('late_' + tabName(b.cls));
    setLate(name, late);
    const gd = getGender(b.cls);
    PropertiesService.getDocumentProperties().deleteProperty('gender_' + tabName(b.cls));
    setGender(name, gd);
    sh.getRange(1, 1).setValue('📘 فصل ' + name);
    return { cls: name };
  },

  deleteClass: (ss, b) => {
    const sh = ss.getSheetByName(tabName(b.cls));
    if (!sh || !isClass(sh)) throw new Error('الفصل مش موجود');
    if (ss.getSheets().length === 1) ss.insertSheet('الورقة1');
    ss.deleteSheet(sh);
    return {};
  },

  getClass: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const n = nStudents(sh), k = nWeeks(sh);
    const names = n ? sh.getRange(HDR + 1, 2, n, 1).getDisplayValues().map(r => r[0]) : [];
    const weeks = [];
    for (let i = 0; i < k; i++) weeks.push(sh.getRange(1, startCol(i)).getDisplayValue());
    const vals = (n && k) ? sh.getRange(HDR + 1, FIRST_COL, n, k * W).getValues()
      .map(r => r.map(v => (v === '' || v === null) ? '' : (typeof v === 'number' ? Math.round(v * 100) / 100 : v))) : names.map(() => []);
    const term = n ? sh.getRange(HDR + 1, termCol(sh), n, T).getValues()
      .map(r => r.map(v => (v === '' || v === null) ? '' : (typeof v === 'number' ? Math.round(v * 100) / 100 : v))) : [];
    const late = getLate(b.cls).filter(x => names.indexOf(x) >= 0);
    const gender = getGender(b.cls);
    return { names, weeks, vals, term, late, gender, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
  },

  addWeek: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const k = nWeeks(sh), s = startCol(k), n = nStudents(sh);
    sh.insertColumnsBefore(s, W);
    sh.getRange(1, s, Math.max(HDR + n, HDR), W).clear();
    const color = COLORS[k % 2];
    sh.getRange(1, s, HDR, W).getMergedRanges().forEach(r => r.breakApart());
    sh.getRange(1, s, 1, W).merge().setValue(String(b.label || ('الأسبوع ' + (k + 1))))
      .setFontWeight('bold').setHorizontalAlignment('center').setBackground('#a5d6a7');
    sh.getRange(HDR, s, 1, W).setValues([SUB]).setFontWeight('bold').setWrap(true)
      .setHorizontalAlignment('center').setVerticalAlignment('middle').setBackground(color);
    sh.getRange(HDR, s + 6, 1, 2).setBackground('#fff9c4');
    sh.getRange(HDR, s + 10, 1, 1).setBackground('#ffe082');
    for (let c = s; c < s + W; c++) sh.setColumnWidth(c, 62);
    if (n) {
      sh.getRange(HDR + 1, s, n, W).setHorizontalAlignment('center');
      sh.getRange(HDR + 1, s + 10, n, 1).setFontWeight('bold');
      setFormulas(sh, HDR + 1, n, k);
    }
    styleCum(sh, k);
    rewriteCum(sh);
    sh.getRange(1, s, Math.max(HDR + n, HDR), W).setBorder(true, true, true, true, null, null, '#455a64', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    return { week: k };
  },

  deleteWeek: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const k = Number(b.week);
    if (!(k >= 0 && k < nWeeks(sh))) throw new Error('الأسبوع مش موجود');
    if (b.label && sh.getRange(1, startCol(k)).getDisplayValue() !== b.label) throw new Error('الشيت اتغير — حدّث الصفحة');
    sh.deleteColumns(startCol(k), W);
    rewriteCum(sh);
    return {};
  },

  save: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const r = findRow(sh, Number(b.row), String(b.name));
    const k = Number(b.week);
    if (!(k >= 0 && k < nWeeks(sh))) throw new Error('الأسبوع مش موجود');
    const s = startCol(k);
    const v = (b.vals || []).map(cellVal);
    sh.getRange(r, s, 1, 6).setValues([v.slice(0, 6)]);
    sh.getRange(r, s + 8, 1, 2).setValues([[v[6], v[7]]]);
    return {};
  },

  saveTerm: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const r = findRow(sh, Number(b.row), String(b.name));
    const v = (b.vals || []).map(cellVal);
    sh.getRange(r, termCol(sh), 1, 2).setValues([[v[0], v[1]]]);
    return {};
  },

  addStudents: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const names = (b.names || []).map(String).map(s => s.trim()).filter(Boolean);
    if (!names.length) return {};
    const n = nStudents(sh), row = HDR + 1 + n;
    sh.getRange(row, 1, names.length, 2).setValues(names.map((nm, i) => [n + i + 1, nm]));
    const k = nWeeks(sh);
    for (let i = 0; i < k; i++) {
      setFormulas(sh, row, names.length, i);
      sh.getRange(row, startCol(i), names.length, W).setHorizontalAlignment('center');
      sh.getRange(row, startCol(i) + 10, names.length, 1).setFontWeight('bold');
    }
    rewriteCum(sh);
    if (b.late !== false && n > 0) setLate(b.cls, getLate(b.cls).concat(names));
    return {};
  },

  renameStudent: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const r = findRow(sh, Number(b.row), String(b.old));
    sh.getRange(r, 2).setValue(String(b.name).trim());
    const late = getLate(b.cls), i = late.indexOf(String(b.old));
    if (i >= 0) { late[i] = String(b.name).trim(); setLate(b.cls, late); }
    const g = getGender(b.cls);
    if (g[String(b.old)]) { g[String(b.name).trim()] = g[String(b.old)]; delete g[String(b.old)]; setGender(b.cls, g); }
    return {};
  },

  // ترتيب الطلاب: بننقل الصفوف كلها بدرجاتها، وبعدين نرجّع المعادلات
  reorder: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const n = nStudents(sh);
    if (!n) return {};
    const lastCol = sh.getLastColumn();
    const rng = sh.getRange(HDR + 1, 1, n, lastCol);
    const v = rng.getValues();
    const names = v.map(r => String(r[1]));
    const order = (b.order || []).map(String);
    if (order.length !== n) throw new Error('الترتيب مش مطابق — حدّث الصفحة');
    const used = new Array(n).fill(false);
    const rows = order.map(nm => {
      const i = names.findIndex((x, j) => !used[j] && x === nm);
      if (i < 0) throw new Error('الترتيب مش مطابق — حدّث الصفحة');
      used[i] = true;
      return v[i].slice();
    });
    rows.forEach((r, k) => { r[0] = k + 1; });
    rng.setValues(rows);
    const k = nWeeks(sh);
    for (let i = 0; i < k; i++) setFormulas(sh, HDR + 1, n, i);
    rewriteCum(sh);
    if (Array.isArray(b.late)) setLate(b.cls, b.late.map(String));
    return {};
  },

  setGender: (ss, b) => {
    getSh(ss, b.cls);
    const g = getGender(b.cls);
    (b.names || []).forEach(n => { if (b.g === 'b' || b.g === 'g') g[String(n)] = b.g; else delete g[String(n)]; });
    setGender(b.cls, g);
    return {};
  },

  // نقل طلاب من فصل لفصل بدرجاتهم (الأسبوع رقم كذا بيروح للأسبوع بنفس الرقم)
  moveStudents: (ss, b) => {
    const src = getSh(ss, b.from), dst = getSh(ss, b.to);
    if (src.getSheetId() === dst.getSheetId()) throw new Error('اختار فصل تاني');
    const ns = nStudents(src), nd = nStudents(dst), kS = nWeeks(src), kD = nWeeks(dst);
    const srcNames = ns ? src.getRange(HDR + 1, 2, ns, 1).getDisplayValues().map(r => r[0]) : [];
    const dstNorm = (nd ? dst.getRange(HDR + 1, 2, nd, 1).getDisplayValues().map(r => r[0]) : []).map(normName);
    const plan = [], skipped = [];
    (b.names || []).map(String).forEach(name => {
      const i = srcNames.indexOf(name);
      if (i < 0) return;
      if (dstNorm.indexOf(normName(name)) >= 0 || plan.some(p => normName(p.name) === normName(name))) { skipped.push(name); return; }
      const r = HDR + 1 + i, weeks = [];
      for (let k = 0; k < kS; k++) {
        const v = src.getRange(r, startCol(k), 1, W).getValues()[0];
        const inp = v.slice(0, 6).concat([v[8], v[9]]);
        if (k >= kD) { if (inp.some(x => x !== '' && x !== null)) throw new Error('الفصل اللي هتنقل له فيه أسابيع أقل — ضيف الأسابيع الناقصة فيه الأول'); }
        else weeks.push(inp);
      }
      const term = src.getRange(r, termCol(src), 1, 2).getValues()[0];
      plan.push({ name, row: r, weeks, term });
    });
    if (!plan.length) return { moved: [], skipped };
    const start = HDR + 1 + nd;
    dst.getRange(start, 1, plan.length, 2).setValues(plan.map((p, j) => [nd + j + 1, p.name]));
    plan.forEach((p, j) => {
      const r = start + j;
      p.weeks.forEach((inp, k) => {
        const s0 = startCol(k);
        dst.getRange(r, s0, 1, 6).setValues([inp.slice(0, 6)]);
        dst.getRange(r, s0 + 8, 1, 2).setValues([[inp[6], inp[7]]]);
      });
      dst.getRange(r, termCol(dst), 1, 2).setValues([p.term]);
    });
    for (let k = 0; k < kD; k++) {
      setFormulas(dst, start, plan.length, k);
      dst.getRange(start, startCol(k), plan.length, W).setHorizontalAlignment('center');
      dst.getRange(start, startCol(k) + 10, plan.length, 1).setFontWeight('bold');
    }
    rewriteCum(dst);
    plan.map(p => p.row).sort((a, c) => c - a).forEach(r => src.deleteRow(r));
    renumber(src);
    const gS = getGender(b.from), gD = getGender(b.to), moved = plan.map(p => p.name);
    moved.forEach(n => { if (gS[n]) { gD[n] = gS[n]; delete gS[n]; } });
    setGender(b.from, gS); setGender(b.to, gD);
    setLate(b.from, getLate(b.from).filter(x => moved.indexOf(x) < 0));
    setLate(b.to, getLate(b.to).concat(moved));
    return { moved, skipped };
  },

  deleteStudent: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const r = findRow(sh, Number(b.row), String(b.name));
    sh.deleteRow(r);
    renumber(sh);
    setLate(b.cls, getLate(b.cls).filter(x => x !== String(b.name)));
    const g = getGender(b.cls); delete g[String(b.name)]; setGender(b.cls, g);
    return {};
  }
};
