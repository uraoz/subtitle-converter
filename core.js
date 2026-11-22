'use strict';
/*
 * Subtitle Converter core: SRT <-> WebVTT, time shift, BOM / EOL handling.
 * Pure functions, no DOM. Works in browsers (global SubCore) and Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const TIME = '(?:(\\d{1,3}):)?(\\d{1,2}):(\\d{2})[,.](\\d{1,3})';
  const ARROW_RE = new RegExp('^\\s*' + TIME + '\\s*-->\\s*' + TIME + '(.*)$');
  const INLINE_TS_RE = new RegExp('<' + TIME + '>', 'g');

  function toMs(h, m, s, frac) {
    return ((+(h || 0)) * 3600 + (+m) * 60 + (+s)) * 1000 + Number((frac + '00').slice(0, 3));
  }

  /** Decode bytes to string. UTF-8 (BOM stripped) or UTF-16 with BOM. Throws on invalid UTF-8. */
  function decodeBytes(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u[0] === 0xFF && u[1] === 0xFE) return new TextDecoder('utf-16le').decode(u.subarray(2));
    if (u[0] === 0xFE && u[1] === 0xFF) return new TextDecoder('utf-16be').decode(u.subarray(2));
    let s = new TextDecoder('utf-8', { fatal: true }).decode(u); // fatal: reject non-UTF-8 (e.g. Shift_JIS)
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    return s;
  }

  function detectEol(text) {
    const crlf = (text.match(/\r\n/g) || []).length;
    const lf = (text.match(/\n/g) || []).length - crlf;
    return crlf > lf ? '\r\n' : '\n';
  }

  /** Detect 'vtt' or 'srt' from content (BOM-tolerant). */
  function detectFormat(text) {
    return /^﻿?WEBVTT(?=[ \t\r\n]|$)/.test(text) ? 'vtt' : 'srt';
  }

  /**
   * Parse SRT or VTT text -> { format, eol, cues: [{start, end, text}] } (times in ms).
   * VTT header, NOTE / STYLE / REGION blocks, cue ids and cue settings are dropped.
   */
  function parse(input) {
    let text = String(input);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const eol = detectEol(text);
    const format = detectFormat(text);
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const cues = [];
    let block = [];
    const flush = () => {
      if (!block.length) return;
      const b = block; block = [];
      const ai = b.findIndex(l => ARROW_RE.test(l));
      if (ai < 0) return; // header / NOTE / STYLE / REGION / junk
      if (ai > 1) return; // arrow must be on line 0 or 1 (after id); otherwise not a cue
      const m = ARROW_RE.exec(b[ai]);
      const body = b.slice(ai + 1).join('\n');
      cues.push({ start: toMs(m[1], m[2], m[3], m[4]), end: toMs(m[5], m[6], m[7], m[8]), text: body });
    };
    for (const line of lines) {
      if (line.trim() === '') flush(); else block.push(line);
    }
    flush();
    return { format, eol, cues };
  }

  /** Shift all cues by deltaMs. Start clamps at 0; cues ending at/before 0 are dropped. */
  function shift(cues, deltaMs) {
    const d = Math.round(Number(deltaMs) || 0);
    if (!d) return { cues: cues.map(c => ({ ...c })), dropped: 0 };
    const out = [];
    let dropped = 0;
    for (const c of cues) {
      const end = c.end + d;
      if (end <= 0) { dropped++; continue; }
      out.push({ start: Math.max(0, c.start + d), end, text: shiftInline(c.text, d) });
    }
    return { cues: out, dropped };
  }

  // VTT karaoke-style inline timestamps <00:00:01.000> move with the cue.
  function shiftInline(text, d) {
    return text.replace(INLINE_TS_RE, (_, h, m, s, f) => {
      const t = Math.max(0, toMs(h, m, s, f) + d);
      return '<' + fmt(t, '.') + '>';
    });
  }

  const p2 = n => String(n).padStart(2, '0');
  function fmt(ms, sep) {
    ms = Math.max(0, Math.round(ms));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000;
    return p2(h) + ':' + p2(m) + ':' + p2(s) + sep + String(f).padStart(3, '0');
  }

  /** Serialize cues. format: 'srt' | 'vtt'. eol: '\n' | '\r\n'. No BOM is written. */
  function serialize(cues, format, eol) {
    eol = eol || '\n';
    const nl = t => t.replace(/\n/g, eol);
    if (format === 'vtt') {
      const parts = cues.map(c => fmt(c.start, '.') + ' --> ' + fmt(c.end, '.') + eol + nl(toVttText(c.text)));
      return 'WEBVTT' + eol + eol + parts.join(eol + eol) + (parts.length ? eol : '');
    }
    const parts = cues.map((c, i) => (i + 1) + eol + fmt(c.start, ',') + ' --> ' + fmt(c.end, ',') + eol + nl(toSrtText(c.text)));
    return parts.join(eol + eol) + (parts.length ? eol : '');
  }

  // SRT inline timestamps don't exist; convert any "<00:00:01,000>" to VTT form, and escape nothing else.
  function toVttText(t) { return t.replace(INLINE_TS_RE, (_, h, m, s, f) => '<' + fmt(toMs(h, m, s, f), '.') + '>'); }
  // VTT-only inline timestamps have no SRT meaning: drop them.
  // VTT-only tags (v, c, ruby, rt, lang) are removed but their inner text is kept; <i> <b> <u> <font> stay.
  const VTT_TAG_RE = /<\/?(?:v|c|ruby|rt|lang)(?:[.\s][^>]*)?>/gi;
  function toSrtText(t) { return t.replace(INLINE_TS_RE, '').replace(VTT_TAG_RE, ''); }

  /**
   * One-shot conversion.
   * opts: { to: 'auto'|'srt'|'vtt', shiftMs: number, eol: 'auto'|'lf'|'crlf' }
   * Returns { text, from, to, count, dropped }.
   */
  function convert(input, opts) {
    opts = opts || {};
    const p = parse(input);
    const to = !opts.to || opts.to === 'auto' ? (p.format === 'srt' ? 'vtt' : 'srt') : opts.to;
    const eol = opts.eol === 'crlf' ? '\r\n' : opts.eol === 'lf' ? '\n' : p.eol;
    const s = shift(p.cues, opts.shiftMs || 0);
    return { text: serialize(s.cues, to, eol), from: p.format, to, count: s.cues.length, dropped: s.dropped };
  }

  function outputName(name, to) {
    const base = name.replace(/\.(srt|vtt|txt)$/i, '');
    return base + '.' + to;
  }

  return { decodeBytes, detectEol, detectFormat, parse, shift, serialize, convert, outputName, fmt };
});
