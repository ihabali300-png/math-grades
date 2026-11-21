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
    sh.setName(name);
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
    return { names, weeks, vals, term, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
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
    const v = (b.vals || []).map(x => (x === '' || x === null || x === undefined) ? '' : Number(x));
    sh.getRange(r, s, 1, 6).setValues([v.slice(0, 6)]);
    sh.getRange(r, s + 8, 1, 2).setValues([[v[6], v[7]]]);
    return {};
  },

  saveTerm: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const r = findRow(sh, Number(b.row), String(b.name));
    const v = (b.vals || []).map(x => (x === '' || x === null || x === undefined) ? '' : Number(x));
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
    return {};
  },

  renameStudent: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const r = findRow(sh, Number(b.row), String(b.old));
    sh.getRange(r, 2).setValue(String(b.name).trim());
    return {};
  },

  deleteStudent: (ss, b) => {
    const sh = getSh(ss, b.cls);
    const r = findRow(sh, Number(b.row), String(b.name));
    sh.deleteRow(r);
    renumber(sh);
    return {};
  }
};
