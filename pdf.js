// Paper version of a guide: a text-only, black and white A4 PDF, written by hand
// (standard Helvetica fonts, no library) so it also works offline.

const PDF_W = 595.28, PDF_H = 841.89; // A4 in points

// A string as a PDF literal in WinAnsi encoding; anything outside it becomes "?".
function pdfStr(s) {
  const special = { '’': "'", '‘': "'", '“': '"', '”': '"', '–': '\\226', '—': '\\227', '−': '\\226', '…': '\\205' };
  return [...s].map(ch => {
    if (special[ch]) return special[ch];
    const code = ch.charCodeAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') return '\\' + ch;
    if (code >= 32 && code < 127) return ch;
    if (code >= 160 && code <= 255) return '\\' + code.toString(8);
    return '?';
  }).join('');
}

// Pages (each a list of drawing operators) to a PDF file.
function pdfFile(pages) {
  const font = name => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', font('Helvetica'), font('Helvetica-Bold'), font('Helvetica-Oblique')];
  const kids = [];
  for (const ops of pages) {
    const stream = ops.join('\n');
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${objs.length} 0 R >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([Uint8Array.from(out, ch => ch.charCodeAt(0))], { type: 'application/pdf' });
}

function guidePdf(l, v) {
  const M = 28, GAP = 14, PAD = 6; // page margin, gap between the two columns, box padding
  const colW = (PDF_W - 2 * M - GAP) / 2;
  const ctx = document.createElement('canvas').getContext('2d');
  const FONTS = { r: ['F1', ''], b: ['F2', 'bold '], i: ['F3', 'italic '] };
  // Arial has the same metrics as Helvetica, so the canvas can measure for the PDF.
  const width = (s, size, f = 'r') => {
    ctx.font = `${FONTS[f][1]}${size}px Arial, Helvetica, sans-serif`;
    return ctx.measureText(s).width;
  };
  const wrap = (s, size, f, max) => {
    const lines = [];
    let cur = '';
    for (const word of s.split(/\s+/)) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && width(next, size, f) > max) { lines.push(cur); cur = word; } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const mus = [...v.matchups].sort((a, b) => byName(a.opponent, b.opponent));

  // Lays the whole guide out at one text size. y runs downward from the top of the page.
  function compose(size) {
    const pages = [[]];
    let ops = pages[0];
    const n = x => x.toFixed(2);
    const text = (s, x, y, sz, f = 'r') => ops.push(`BT /${FONTS[f][0]} ${n(sz)} Tf ${n(x)} ${n(PDF_H - y)} Td (${pdfStr(s)}) Tj ET`);
    const rule = (x1, y, x2, w, dash) => ops.push(`${w} w ${dash ? '[2 2] 0 d' : '[] 0 d'} ${n(x1)} ${n(PDF_H - y)} m ${n(x2)} ${n(PDF_H - y)} l S`);
    const lh = size * 1.28;

    // One matchup as a list of draw steps plus its height, so it can be placed afterwards.
    function box(m) {
      const plans = m.second ? [[m, 'GOING 1ST'], [m.second, 'GOING 2ND']] : [[m, '']];
      const inner = colW - 2 * PAD;
      const subW = plans.length === 2 ? (inner - 12) / 2 : inner;
      const steps = [];
      let h = PAD + size * 1.25;
      steps.push((x, y) => text(m.opponent, x + PAD, y + h0, size * 1.25, 'b'));
      const h0 = h;
      h += size * 0.5;
      let tallest = 0;
      plans.forEach(([p, label], k) => {
        const dx = PAD + k * (subW + 12);
        let py = h;
        if (label) { py += size * 0.9; const at = py; steps.push((x, y) => text(label, x + dx, y + at, size * 0.8, 'b')); py += size * 0.35; }
        const cards = (list, sign) => [...list].sort((a, b) => byName(a.name, b.name)).forEach(c => {
          const prefix = `${sign}${c.qty} `;
          const pw = width(prefix, size, 'b');
          wrap(c.name, size, 'r', subW - pw).forEach((line, i) => {
            py += lh;
            const at = py;
            steps.push((x, y) => { if (!i) text(prefix, x + dx, y + at, size, 'b'); text(line, x + dx + pw, y + at, size); });
          });
        });
        cards(p.ins, '+');
        py += size * 0.55;
        const at = py;
        steps.push((x, y) => rule(x + dx, y + at, x + dx + subW, 0.5, true));
        cards(p.outs, '−');
        tallest = Math.max(tallest, py);
      });
      if (plans.length === 2) {
        const from = h + size * 0.3, to = tallest, lx = PAD + subW + 6;
        steps.push((x, y) => ops.push(`0.5 w [] 0 d ${n(x + lx)} ${n(PDF_H - y - from)} m ${n(x + lx)} ${n(PDF_H - y - to)} l S`));
      }
      h = tallest;
      if (m.note) {
        h += size * 0.3;
        wrap(m.note, size * 0.95, 'i', inner).forEach(line => {
          h += lh;
          const at = h;
          steps.push((x, y) => text(line, x + PAD, y + at, size * 0.95, 'i'));
        });
      }
      h += PAD + size * 0.2;
      const height = h;
      steps.push((x, y) => ops.push(`0.75 w [] 0 d ${n(x)} ${n(PDF_H - y - height)} ${n(colW)} ${n(height)} re S`));
      return { height, draw: (x, y) => steps.forEach(s => s(x, y)) };
    }

    let y = M + size * 1.5;
    text(l.name, M, y, size * 1.7, 'b');
    text('sideboard guide', M + width(l.name, size * 1.7, 'b') + 6, y, size * 1.2);
    const meta = [`v${v.n}`, titleOf(v), setOf(v).name, fmtDate(v.date)].filter(Boolean).join(' · ');
    text(meta, PDF_W - M - width(meta, size), y, size);
    y += 6;
    rule(M, y, PDF_W - M, 1.5);
    y += size * 1.3;
    text('+ in from sideboard      − out of main deck', M, y, size * 0.9);
    y += 9;

    let top = y, col = 0, cy = top;
    for (const m of mus) {
      const b = box(m);
      if (cy + b.height > PDF_H - M && cy > top) {
        col++;
        if (col > 1) { ops = []; pages.push(ops); col = 0; top = M; }
        cy = top;
      }
      b.draw(M + col * (colW + GAP), cy);
      cy += b.height + 7;
    }
    return pages;
  }

  // Largest text that fits one page, from 12pt down to 8pt. Below that, a second page
  // reads better than smaller print.
  let pages;
  for (let size = 12; size >= 8; size -= 0.5) {
    pages = compose(size);
    if (pages.length === 1) break;
  }
  return pdfFile(pages);
}
