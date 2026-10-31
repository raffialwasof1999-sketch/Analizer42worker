/**
 * Dashboard-only shared assumptions, controlled by merged Analyzer!D12:E12 (value stored in D12).
 * D12 is the merged-cell P/E & P/FCF assumptions dropdown.
 * A simple edit trigger is separate from the existing SEC refresh trigger.
 * No network requests, data-sheet writes, row hiding, or Worker changes.
 * Shared mode keeps E16:G16 and E17:G17 independently editable. Only
 * E18:G19 multiples and E25:G26 results are merged. Legacy saved FCF
 * margins are restored before upgrading an already-merged dashboard.
 * Never create or restore cell notes. Existing reference-tab notes are
 * maintained manually; legacy backup notes are deliberately ignored.
 */
const AA_SV = Object.freeze({
  sheet: 'Analyzer', control: 'D12',
  sharedLabel: 'Use Shared P/E & P/FCF Assumptions', separateLabel: 'Use Separate P/E & P/FCF Assumptions',
  backupRanges: ['E19:G19', 'E26:G26', 'A18', 'A19', 'A25', 'A26'],
  mergeRanges: ['A18:D19',
    'E18:E19', 'F18:F19', 'G18:G19', 'A25:D26',
    'E25:E26', 'F25:F26', 'G25:G26']
});

function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== AA_SV.sheet ||
      e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1 ||
      e.range.getA1Notation() !== AA_SV.control) return;
  const sheet = e.range.getSheet();
  const lock = LockService.getDocumentLock();
  if (!lock || !lock.tryLock(5000)) {
    sheet.getRange(AA_SV.control).setValue(aaSvMerged_(sheet) ? AA_SV.sharedLabel : AA_SV.separateLabel);
    e.source.toast('Another update is running. Please try the shared-mode dropdown again.', 'Shared valuation', 8);
    return;
  }
  try {
    aaSvSetMode_(sheet, PropertiesService.getDocumentProperties(),
      sheet.getRange(AA_SV.control).getDisplayValue() === AA_SV.sharedLabel);
    SpreadsheetApp.flush();
  } catch (error) {
    console.error('Shared valuation: ' + String(error.message || error));
    e.source.toast(String(error.message || error), 'Shared valuation', 10);
  } finally { lock.releaseLock(); }
}

function aaSvMerged_(sheet) {
  return sheet.getRange('E18:E19').getMergedRanges()
    .some(r => r.getA1Notation() === 'E18:E19');
}

function aaSvKey_(sheet) { return 'AA_SHARED_VALUATION_V1_' + sheet.getSheetId(); }

function aaSvCapture_(sheet) {
  const entries = {};
  for (const address of AA_SV.backupRanges) {
    const r = sheet.getRange(address), values = r.getValues(), formulas = r.getFormulas();
    entries[address] = {data: values.map((row, i) => row.map((v, j) => formulas[i][j] || v)),
      formats: r.getNumberFormats()};
  }
  return {version: 2, sheetId: sheet.getSheetId(), entries};
}

function aaSvMigrateMargins_(sheet, snapshot) {
  const ranges = ['E16:E17', 'F16:F17', 'G16:G17'];
  const merged = sheet.getRange('E16:G17').getMergedRanges()
    .map(r => r.getA1Notation());
  if (!merged.length) return;
  const entry = snapshot && snapshot.entries && snapshot.entries['E17:G17'];
  if (merged.some(a => !ranges.includes(a)) || !entry || !entry.data ||
      entry.data.length !== 1 || entry.data[0].length !== 3)
    throw Error('Saved FCF margins are unavailable or the margin layout changed; no margins were overwritten.');
  sheet.getRange('E16:G17').breakApart();
  sheet.getRange('E17:G17').setValues(entry.data).clearNote()
    .setNumberFormats([['General%;[Red]-General%;0%', 'General%;[Red]-General%;0%', 'General%;[Red]-General%;0%']]);
  for (const address of ['E16:G16', 'E17:G17'])
    sheet.getRange(address).setBorder(true, null, true, null, null, null);
}

function aaSvIndependentMarginFormula_(formula, column) {
  const shared = '($D$12="Use Shared P/E & P/FCF Assumptions")';
  return formula
    .replace('ISNUMBER(' + column + '16),ISNUMBER(' + column + '18)',
      'ISNUMBER(' + column + '16),IF(' + shared + ',ISNUMBER(' + column + '17),TRUE),ISNUMBER(' + column + '18)')
    .replace('m,' + column + '16,mult,' + column + '18',
      'm,IF(' + shared + ',AVERAGE(' + column + '16,' + column + '17),' + column + '16),mult,' + column + '18');
}

function aaSvUpdateResultMargins_(sheet) {
  for (const column of ['E', 'F', 'G']) {
    const range = sheet.getRange(column + '25');
    const formula = range.getFormulas()[0][0];
    const updated = aaSvIndependentMarginFormula_(formula, column);
    if (updated !== formula) range.setValue(updated);
  }
}

function aaSvRestore_(sheet, snapshot) {
  // Only the approved assumption/result cells are unmerged. Adjacent
  // historical data A16:D17 and comparison metrics H:L are never touched.
  for (const address of ['E16:G17', 'A18:G19', 'A25:G26'])
    sheet.getRange(address).breakApart();
  for (const address of AA_SV.backupRanges) {
    const entry = snapshot.entries[address];
    // Old version-1 backups can include notes. Never restore them, even
    // on rollback; preserve only independent inputs, formulas and formats.
    sheet.getRange(address).setValues(entry.data).clearNote()
      .setNumberFormats(entry.formats);
  }
  for (const address of ['A18:D18', 'A19:D19', 'A25:D25', 'A26:D26'])
    sheet.getRange(address).merge();
  // Restore the original row dividers, without changing colors or fonts.
  for (const address of ['E16:G16', 'E17:G17', 'A18:G18', 'A19:G19', 'A25:G25', 'A26:G26'])
    sheet.getRange(address).setBorder(true, null, true, null, null, null);
}

function aaSvSetMode_(sheet, properties, enabled) {
  if (!properties) throw Error('Document backup storage is unavailable; nothing was combined.');
  const key = aaSvKey_(sheet), raw = properties.getProperty(key);
  let snapshot = raw ? JSON.parse(raw) : null;
  if (snapshot && (![1, 2].includes(snapshot.version) || snapshot.sheetId !== sheet.getSheetId() ||
      !snapshot.entries || AA_SV.backupRanges.some(a => !snapshot.entries[a])))
    throw Error('Shared-mode backup is invalid. No saved assumptions were overwritten.');
  if (!snapshot && !enabled) {
    if (aaSvMerged_(sheet)) {
      sheet.getRange(AA_SV.control).setValue(AA_SV.sharedLabel);
      throw Error('Saved independent inputs are unavailable; shared mode was kept.');
    }
    return;
  }
  if (enabled && !snapshot) {
    if (aaSvMerged_(sheet)) throw Error('Already merged without a backup. No assumptions were overwritten.');
    // Refuse an unexpectedly rearranged dashboard instead of destroying data.
    const expected = ['A18:D18', 'A19:D19', 'A25:D25', 'A26:D26'];
    const found = ['E16:G17', 'A18:G19', 'A25:G26'].flatMap(a =>
      sheet.getRange(a).getMergedRanges().map(r => r.getA1Notation()));
    if (found.length !== expected.length || expected.some(a => !found.includes(a))) {
      sheet.getRange(AA_SV.control).setValue(AA_SV.separateLabel);
      throw Error('Dashboard layout changed; shared mode was not applied.');
    }
    snapshot = aaSvCapture_(sheet);
    // ASCII serialization gives a reliable byte count below the per-property limit.
    const serialized = JSON.stringify(snapshot).replace(/[\u007f-\uffff]/g,
      c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    if (serialized.length > 8500) {
      sheet.getRange(AA_SV.control).setValue(AA_SV.separateLabel);
      throw Error('Assumption backup is too large; nothing was combined.');
    }
    try {
      properties.setProperty(key, serialized);
      if (properties.getProperty(key) !== serialized) throw Error('Backup verification failed.');
    } catch (error) {
      sheet.getRange(AA_SV.control).setValue(AA_SV.separateLabel);
      throw error;
    }
  }
  // Reject a missing legacy margin backup before the rollback path can
  // unmerge cells or delete the only saved independent inputs.
  aaSvMigrateMargins_(sheet, snapshot);
  try {
    aaSvUpdateResultMargins_(sheet);
    if (!enabled) {
      aaSvRestore_(sheet, snapshot);
      sheet.getRange(AA_SV.control).setValue(AA_SV.separateLabel);
      SpreadsheetApp.flush();
      properties.deleteProperty(key);
      return;
    }
    // Safe to repeat: do not replace the original independent-input backup.
    for (const address of ['E16:G17', 'A18:G19', 'A25:G26'])
      sheet.getRange(address).breakApart();
    for (const address of ['A19:G19', 'A26:G26'])
      sheet.getRange(address).clearContent().clearNote();
    sheet.getRange('A18').setValue('Assumed P/E / Price-to-FCF Multiple\n(Shared; End of Projection)')
      .clearNote();
    sheet.getRange('A25').setValue('Maximum Purchase Price Today to Achieve Desired Return\n(Average of Profit / FCF Valuations; Shared Multiple)')
      .clearNote();
    for (const address of AA_SV.mergeRanges) sheet.getRange(address).merge();
    sheet.getRange(AA_SV.control).setValue(AA_SV.sharedLabel);
  } catch (error) {
    // Keep the backup until restoration has completed successfully.
    try {
      aaSvRestore_(sheet, snapshot);
      sheet.getRange(AA_SV.control).setValue(AA_SV.separateLabel);
      SpreadsheetApp.flush();
      properties.deleteProperty(key);
    } catch (_) {
      sheet.getRange(AA_SV.control).setValue(AA_SV.sharedLabel);
      throw Error('Layout update failed; saved inputs were retained. Choose Separate in D12 again to retry restoration.');
    }
    throw Error('Layout update failed and the separate inputs were restored: ' + String(error.message || error));
  }
}
