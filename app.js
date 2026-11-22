'use strict';
/* UI glue: drag & drop, live conversion (re-run on option change), per-file download, EN/JA. */

const I18N = {
  en: {
    title: 'SRT ⇄ WebVTT Subtitle Converter',
    sub: 'Convert subtitles and shift timing. 100% offline — files never leave this device.',
    dropTitle: 'Drop subtitle files here', dropHint: 'or click to choose files (.srt, .vtt)',
    output: 'Output', auto: 'Auto (SRT ⇄ VTT)', shift: 'Shift', sec: 'seconds', ms: 'milliseconds', clear: 'Clear',
    shiftHelp: 'Shift applies to every file. Positive = later, negative = earlier.',
    note: 'Free · No ads · Files never leave your PC. UTF-8 files only (BOM is handled). VTT header, NOTE and STYLE blocks are dropped when converting.',
    download: 'Download', cues: n => n + ' cues', dropped: n => n + ' dropped (before 0:00)',
    errEncoding: 'Not UTF-8 — please re-save as UTF-8', errEmpty: 'No subtitle cues found', done: 'Ready',
  },
  ja: {
    title: 'SRT ⇄ WebVTT 字幕変換',
    sub: '字幕形式の変換と時間ずらし。完全オフライン動作。ファイルは端末の外に出ません。',
    dropTitle: 'ここに字幕ファイルをドロップ', dropHint: 'またはクリックして選択 (.srt, .vtt)',
    output: '出力形式', auto: '自動 (SRT ⇄ VTT)', shift: '時間ずらし', sec: '秒', ms: 'ミリ秒', clear: 'クリア',
    shiftHelp: 'すべてのファイルに適用します。正の値＝遅らせる、負の値＝早める。',
    note: '無料・広告なし・ファイルは PC の外に出ません。UTF-8 のみ対応（BOM は自動処理）。変換時に VTT のヘッダー・NOTE・STYLE は削除されます。',
    download: 'ダウンロード', cues: n => n + ' 件', dropped: n => n + ' 件が 0:00 より前のため削除',
    errEncoding: 'UTF-8 ではありません。UTF-8 で保存し直してください', errEmpty: '字幕が見つかりません', done: '変換済み',
  },
};

const $ = id => document.getElementById(id);
const drop = $('drop'), picker = $('picker'), list = $('list'), clearBtn = $('clearBtn');
const toSel = $('to'), shiftVal = $('shiftVal'), shiftUnit = $('shiftUnit'), langSel = $('lang');

let lang = 'en';
try { lang = localStorage.getItem('subconv.lang') || ''; } catch (e) {}
if (!I18N[lang]) lang = /^ja/i.test(navigator.language || '') ? 'ja' : 'en';
const t = k => I18N[lang][k];

const items = []; // { name, text, error, result }

function shiftMs() { return Math.round((parseFloat(shiftVal.value) || 0) * Number(shiftUnit.value)); }

function convertAll() {
  const opts = { to: toSel.value, shiftMs: shiftMs() };
  for (const it of items) {
    if (it.error) continue;
    try {
      it.result = SubCore.convert(it.text, opts);
      it.errKey = it.result.count ? '' : 'errEmpty';
    } catch (e) { it.errKey = 'errEmpty'; it.result = null; }
  }
}

function render() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  list.textContent = '';
  for (const it of items) {
    const li = document.createElement('li');
    const meta = document.createElement('div'); meta.className = 'meta';
    const name = document.createElement('div'); name.className = 'name';
    const detail = document.createElement('div'); detail.className = 'detail';
    const status = document.createElement('div'); status.className = 'status';
    const err = it.error || it.errKey;
    if (err) {
      name.textContent = it.name; status.textContent = t(err); status.classList.add('error');
      li.append(meta, status);
    } else {
      const r = it.result;
      name.textContent = SubCore.outputName(it.name, r.to);
      detail.textContent = it.name + ' · ' + r.from.toUpperCase() + ' → ' + r.to.toUpperCase() + ' · ' + t('cues')(r.count)
        + (r.dropped ? ' · ' + t('dropped')(r.dropped) : '');
      status.textContent = t('done'); status.classList.add('done');
      const btn = document.createElement('button'); btn.textContent = t('download');
      btn.addEventListener('click', () => download(it));
      li.append(meta, status, btn);
    }
    meta.append(name, detail);
    list.append(li);
  }
  clearBtn.disabled = !items.length;
}

function download(it) {
  const r = it.result;
  const mime = r.to === 'vtt' ? 'text/vtt' : 'application/x-subrip';
  const url = URL.createObjectURL(new Blob([r.text], { type: mime + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = SubCore.outputName(it.name, r.to);
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function addFiles(files) {
  for (const f of files) {
    const it = { name: f.name };
    try { it.text = SubCore.decodeBytes(new Uint8Array(await f.arrayBuffer())); }
    catch (e) { it.error = 'errEncoding'; }
    items.push(it);
  }
  convertAll(); render();
}

drop.addEventListener('click', () => picker.click());
drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } });
picker.addEventListener('change', () => { addFiles([...picker.files]); picker.value = ''; });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('dragover'); }));
drop.addEventListener('drop', e => addFiles([...e.dataTransfer.files]));
[toSel, shiftVal, shiftUnit].forEach(el => el.addEventListener('input', () => { convertAll(); render(); }));
clearBtn.addEventListener('click', () => { items.length = 0; render(); });
langSel.addEventListener('change', () => { lang = langSel.value; try { localStorage.setItem('subconv.lang', lang); } catch (e) {} render(); });
langSel.value = lang;
render();
