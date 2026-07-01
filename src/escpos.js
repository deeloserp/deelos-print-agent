// src/escpos.js
'use strict';

const ESC = '\x1B';
const GS = '\x1D';

const FONT = {
  ' ': ['000','000','000','000','000','000','000'],
  '.': ['0','0','0','0','0','1','1'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '/': ['00001','00010','00100','01000','10000','00000','00000'],
  ':': ['0','1','1','0','1','1','0'],
  '₵': [
    '001000',
    '011110',
    '100001',
    '100000',
    '111110',
    '100001',
    '011110'
  ],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','11100'],
  'A': ['01110','10001','10001','11111','10001','10001','10001'],
  'B': ['11110','10001','10001','11110','10001','10001','11110'],
  'C': ['01110','10001','10000','10000','10000','10001','01110'],
  'D': ['11110','10001','10001','10001','10001','10001','11110'],
  'E': ['11111','10000','10000','11110','10000','10000','11111'],
  'F': ['11111','10000','10000','11110','10000','10000','10000'],
  'G': ['01110','10001','10000','10111','10001','10001','01110'],
  'H': ['10001','10001','10001','11111','10001','10001','10001'],
  'I': ['01110','00100','00100','00100','00100','00100','01110'],
  'J': ['00111','00010','00010','00010','10010','10010','01100'],
  'K': ['10001','10010','10100','11000','10100','10010','10001'],
  'L': ['10000','10000','10000','10000','10000','10000','11111'],
  'M': ['10001','11011','10101','10101','10001','10001','10001'],
  'N': ['10001','10001','11001','10101','10011','10001','10001'],
  'O': ['01110','10001','10001','10001','10001','10001','01110'],
  'P': ['11110','10001','10001','11110','10000','10000','10000'],
  'Q': ['01110','10001','10001','10001','10101','10010','01101'],
  'R': ['11110','10001','10001','11110','10100','10010','10001'],
  'S': ['01111','10000','10000','01110','00001','00001','11110'],
  'T': ['11111','00100','00100','00100','00100','00100','00100'],
  'U': ['10001','10001','10001','10001','10001','10001','01110'],
  'V': ['10001','10001','10001','10001','10001','01010','00100'],
  'W': ['10001','10001','10001','10101','10101','10101','01010'],
  'X': ['10001','10001','01010','00100','01010','10001','10001'],
  'Y': ['10001','10001','01010','00100','00100','00100','00100'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
  '?': ['01110','10001','00001','00010','00100','00000','00100']
};

function line(width = 42, char = '-') {
  return char.repeat(width) + '\n';
}

function clean(value) {
  return String(value == null ? '' : value)
    .replace(/\r/g, '')
    .replace(/[^\t\n\r\x20-\x7E¢£¥€₵]/g, '');
}

function strip(value) {
  return clean(value).trim();
}

function isPresent(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function num(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const raw = String(value == null ? '' : value)
    .replace(/,/g, '')
    .replace(/[^0-9.\-]/g, '');

  if (!raw || raw === '-' || raw === '.') return 0;

  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return num(value).toFixed(2);
}

function extractAmount(value) {
  const text = strip(value);
  if (!text) return '';

  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!matches || !matches.length) return '';
  return matches[matches.length - 1].replace(/,/g, '');
}

function plainMoney(value, label) {
  if (isPresent(label)) {
    const extracted = extractAmount(label);
    if (extracted) return money(extracted);
    return strip(label);
  }
  return money(value);
}

function center(text, width = 42) {
  text = clean(text);
  if (text.length >= width) return text + '\n';

  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text + '\n';
}

function wrapText(text, width = 42, indent = '') {
  text = strip(text);
  if (!text) return '';

  const words = text.split(/\s+/);
  const lines = [];
  let current = '';

  words.forEach(word => {
    if (!current) {
      current = word;
      return;
    }

    if ((indent + current + ' ' + word).length > width) {
      lines.push(indent + current);
      current = word;
    } else {
      current += ' ' + word;
    }
  });

  if (current) lines.push(indent + current);
  return lines.join('\n') + '\n';
}

function columns(left, right, width = 42) {
  left = clean(left);
  right = clean(right);

  const space = width - left.length - right.length;
  if (space <= 1) {
    return left.slice(0, width) + '\n' + right.padStart(width) + '\n';
  }

  return left + ' '.repeat(space) + right + '\n';
}

function labelValue(label, value, width = 42) {
  if (!isPresent(value)) return '';
  return columns(label, strip(value), width);
}

function itemLine(item, width = 42) {
  const qty = item.qty || item.quantity || 1;
  const name = strip(item.name || item.product_name || item.description || 'Item');
  const right = plainMoney(item.total ?? item.line_total ?? item.amount ?? item.line_total_cents, item.total_label || item.line_total_label || item.amount_label || null);
  const left = `${qty} x ${name}`;

  if (left.length + right.length + 1 <= width) {
    return columns(left, right, width);
  }

  let out = '';
  out += wrapText(left, width, '');
  out += right.padStart(width) + '\n';
  return out;
}

function init() {
  return ESC + '@';
}

function bold(on = true) {
  return ESC + 'E' + (on ? '\x01' : '\x00');
}

function align(value = 'left') {
  const map = { left: 0, center: 1, right: 2 };
  return ESC + 'a' + String.fromCharCode(map[value] ?? 0);
}

function printMode(mode = 0) {
  return ESC + '!' + String.fromCharCode(mode);
}

function textSize(widthFactor = 1, heightFactor = 1) {
  const w = Math.max(1, Math.min(8, Number(widthFactor || 1))) - 1;
  const h = Math.max(1, Math.min(8, Number(heightFactor || 1))) - 1;
  return GS + '!' + String.fromCharCode((w << 4) | h);
}

function cut() {
  return GS + 'V' + '\x41' + '\x03';
}

function feed(lines = 3) {
  return '\n'.repeat(lines);
}

function qrCode(text) {
  text = strip(text);
  if (!text) return '';

  const data = clean(text);
  const len = data.length + 3;
  const pL = len % 256;
  const pH = Math.floor(len / 256);

  let out = '';
  out += GS + '(k' + '\x04\x00' + '1A' + '\x32\x00';
  out += GS + '(k' + '\x03\x00' + '1C' + '\x06';
  out += GS + '(k' + '\x03\x00' + '1E' + '\x31';
  out += GS + '(k' + String.fromCharCode(pL) + String.fromCharCode(pH) + '1P0' + data;
  out += GS + '(k' + '\x03\x00' + '1Q0';
  return out;
}

function firstValue(payload, keys) {
  for (const key of keys) {
    const parts = String(key).split('.');
    let value = payload;

    for (const part of parts) {
      if (value && Object.prototype.hasOwnProperty.call(value, part)) {
        value = value[part];
      } else {
        value = undefined;
        break;
      }
    }

    if (isPresent(value)) return value;
  }

  return '';
}

function normalizeTaxLine(tax) {
  const name = strip(tax.name || tax.tax_name || tax.label || tax.tax_code || tax.code || 'Tax');
  const rate = firstValue(tax, ['rate', 'tax_rate', 'rate_pct', 'percentage']);
  const amountLabel = firstValue(tax, ['amount_label', 'tax_amount_label', 'total_label']);
  const amount = firstValue(tax, ['amount', 'tax_amount', 'total', 'amount_cents', 'tax_amount_cents']);

  let label = name;
  if (isPresent(rate) && !/%/.test(label)) {
    label += ` (${num(rate).toString().replace(/\.0+$/, '')}%)`;
  }

  return {
    label,
    amount: plainMoney(amount, amountLabel)
  };
}

function getGlyph(ch) {
  const upper = String(ch || ' ').toUpperCase();
  return FONT[upper] || FONT['?'];
}

function renderLineBitmap(text, scale) {
  const chars = Array.from(String(text || '').toUpperCase());
  const glyphs = chars.map(getGlyph);
  const charSpacing = 1;
  const width = glyphs.reduce((sum, glyph, index) => sum + glyph[0].length + (index < glyphs.length - 1 ? charSpacing : 0), 0);
  const height = 7;
  const pixels = Array.from({ length: height }, () => new Uint8Array(width));

  let cursorX = 0;
  glyphs.forEach((glyph, glyphIndex) => {
    for (let y = 0; y < glyph.length; y++) {
      for (let x = 0; x < glyph[y].length; x++) {
        if (glyph[y][x] === '1') pixels[y][cursorX + x] = 1;
      }
    }
    cursorX += glyph[0].length;
    if (glyphIndex < glyphs.length - 1) cursorX += charSpacing;
  });

  return {
    pixels,
    width,
    height,
    scale: Math.max(1, Number(scale || 1))
  };
}

function drawScaledLine(bitmap, paperWidth, line, topY) {
  const scaledWidth = line.width * line.scale;
  const scaledHeight = line.height * line.scale;
  const startX = Math.max(0, Math.floor((paperWidth - scaledWidth) / 2));

  for (let y = 0; y < line.height; y++) {
    for (let x = 0; x < line.width; x++) {
      if (!line.pixels[y][x]) continue;
      for (let ys = 0; ys < line.scale; ys++) {
        const py = topY + (y * line.scale) + ys;
        if (!bitmap[py]) continue;
        for (let xs = 0; xs < line.scale; xs++) {
          const px = startX + (x * line.scale) + xs;
          if (px >= 0 && px < paperWidth) bitmap[py][px] = 1;
        }
      }
    }
  }

  return scaledHeight;
}

function bitmapToEscPos(bitmap, width, height) {
  const widthBytes = Math.ceil(width / 8);
  const data = Buffer.alloc(widthBytes * height, 0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!bitmap[y][x]) continue;
      const byteIndex = y * widthBytes + (x >> 3);
      data[byteIndex] |= 0x80 >> (x & 7);
    }
  }

  const header = Buffer.from([
    0x1D, 0x76, 0x30, 0x00,
    widthBytes & 0xff,
    (widthBytes >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff
  ]);

  return Buffer.concat([header, data]);
}

function buildNetTotalImage(payload, widthChars) {
  const paperWidth = widthChars <= 32 ? 384 : 576;
  const symbol = strip(firstValue(payload, ['currency_symbol', 'symbol'])) || '₵';
  const amountText = extractAmount(firstValue(payload, ['net_total_label', 'total_label'])) || money(firstValue(payload, ['net_total', 'total']) || 0);

  const lines = [
    renderLineBitmap('NET TOTAL', widthChars <= 32 ? 4 : 5),
    renderLineBitmap(`${symbol} ${amountText}`, widthChars <= 32 ? 5 : 6)
  ];

  const topPadding = 6;
  const bottomPadding = 4;
  const lineGap = widthChars <= 32 ? 8 : 10;
  const totalHeight = topPadding + bottomPadding + lines.reduce((sum, line, index) => sum + (line.height * line.scale) + (index < lines.length - 1 ? lineGap : 0), 0);
  const bitmap = Array.from({ length: totalHeight }, () => new Uint8Array(paperWidth));

  let cursorY = topPadding;
  lines.forEach((line, index) => {
    cursorY += drawScaledLine(bitmap, paperWidth, line, cursorY);
    if (index < lines.length - 1) cursorY += lineGap;
  });

  return bitmapToEscPos(bitmap, paperWidth, totalHeight);
}

function buildReceipt(job) {
  const payload = job.payload || {};
  const width = Number(payload.paper_width_chars || (String(job.paper_size || '').includes('58') ? 32 : 48));

  const businessName = firstValue(payload, ['business_name', 'company_name', 'business.name']) || 'DEELOS ERP';
  const businessPhone = firstValue(payload, ['business_phone', 'phone', 'business.phone']);
  const businessEmail = firstValue(payload, ['business_email', 'email', 'business.email']);
  const businessWebsite = firstValue(payload, ['business_website', 'website', 'business.website']);
  const branchName = firstValue(payload, ['branch_name', 'branch.name']);
  const orderCode = firstValue(payload, ['order_code', 'order_id']);
  const date = firstValue(payload, ['date', 'created_at']);
  const server = firstValue(payload, ['server', 'cashier', 'operator']);
  const customerName = (firstValue(payload, ['customer_name']) || firstValue(payload, ['customer']) || 'WALK-IN').toString().toUpperCase();
  const customerPhone = firstValue(payload, ['customer_phone']);
  const table = firstValue(payload, ['table', 'table_label']);
  const mode = firstValue(payload, ['mode', 'order_mode']);

  const chunks = [];
  const push = value => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value, 'binary'));

  push(init());
  push(align('center'));
  push(bold(true));
  push(textSize(2, 2));
  push(clean(businessName) + '\n');
  push(textSize(1, 1));
  push(bold(false));
  if (businessPhone) push(clean(businessPhone) + '\n');
  if (businessEmail) push(clean(businessEmail) + '\n');
  if (businessWebsite) push(clean(businessWebsite) + '\n');
  if (branchName) push(clean(branchName) + '\n');
  push(align('left'));

  push(line(width, '='));
  push(bold(true));
  push(columns(payload.title || 'Receipt', orderCode, width));
  push(bold(false));
  if (date) push(columns('Date', date, width));
  if (server) push(columns('Server/Cashier', server, width));
  if (customerName) push(columns('Customer', customerName, width));
  if (customerPhone) push(columns('Phone', customerPhone, width));
  if (table) push(columns('Table', table, width));
  if (mode) push(columns('Order Mode', mode, width));

  push(line(width));
  push(bold(true));
  push(columns('ITEMS', 'TOTAL', width));
  push(bold(false));

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    push(itemLine(item, width));
    if (item.note || item.line_note) push(wrapText('Note: ' + (item.note || item.line_note), width, '  '));
  }

  push(line(width));
  push(labelValue('Subtotal', plainMoney(payload.subtotal, firstValue(payload, ['subtotal_label'])), width));

  const discountPresent = num(payload.discount) > 0 || payload.discount_label;
  if (discountPresent) push(columns('Discount', plainMoney(payload.discount, firstValue(payload, ['discount_label'])), width));

  const taxes = Array.isArray(payload.tax_lines) ? payload.tax_lines
    : Array.isArray(payload.taxes) ? payload.taxes
    : Array.isArray(payload.tax_breakdown) ? payload.tax_breakdown
    : [];

  if (taxes.length) {
    push(line(width));
    push(bold(true));
    push('TAXES\n');
    push(bold(false));
    taxes.forEach(tax => {
      const row = normalizeTaxLine(tax);
      push(columns(row.label, row.amount, width));
    });
  } else if (num(payload.tax) > 0 || payload.tax_label) {
    push(columns('Tax', plainMoney(payload.tax, firstValue(payload, ['tax_label'])), width));
  }

  const deliveryPresent = num(payload.delivery || payload.delivery_fee) > 0 || payload.delivery_label || payload.delivery_fee_label;
  if (deliveryPresent) push(columns('Delivery Fee', plainMoney(payload.delivery || payload.delivery_fee, firstValue(payload, ['delivery_label', 'delivery_fee_label'])), width));

  push(line(width, '='));
  push(align('center'));
  push(buildNetTotalImage(payload, width));
  push(feed(1));
  push(align('left'));

  if (payload.amount_paid != null || payload.amount_paid_label) {
    push(columns('Amount Paid', plainMoney(payload.amount_paid, firstValue(payload, ['amount_paid_label'])), width));
  }

  if (payload.balance != null || payload.balance_label) {
    push(columns('Balance', plainMoney(payload.balance, firstValue(payload, ['balance_label'])), width));
  }

  const qrText = firstValue(payload, ['qr_text', 'tracking_url', 'track_url', 'qr_code_url']);
  if (qrText) {
    push(line(width));
    push(align('center'));
    push(bold(true));
    push(center('TRACK YOUR ORDER ONLINE', width));
    push(bold(false));
    push(feed(1));
    push(qrCode(qrText));
    push(feed(1));
    push(align('left'));
  }

  push(line(width));
  push(align('center'));
  push(bold(true));
  push(center(payload.footer || 'THANK YOU.', width));
  push(bold(false));
  push(center(payload.powered_by || 'POWERED BY DEELOS ERP', width));
  push(feed(3));
  push(cut());

  return Buffer.concat(chunks);
}

function buildKitchenTicket(job) {
  const payload = job.payload || {};
  const width = payload.paper_width_chars || (String(job.paper_size || '').includes('58') ? 32 : 48);

  let out = '';
  out += init();
  out += align('center');
  out += bold(true);
  out += printMode(0x18);
  out += center(payload.title || 'KITCHEN TICKET', width);
  out += printMode(0x00);
  out += bold(false);
  out += align('left');
  out += line(width, '=');

  if (payload.order_code) out += columns('Order', payload.order_code, width);
  if (payload.table) out += columns('Table', payload.table, width);
  if (payload.guests) out += columns('Guests', payload.guests, width);
  if (payload.mode) out += columns('Mode', payload.mode, width);
  if (payload.cashier) out += columns('By', payload.cashier, width);
  if (payload.date) out += columns('Time', payload.date, width);

  out += line(width);

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    out += bold(true);
    out += clean(`${item.qty || item.quantity || 1} x ${item.name || item.product_name || 'Item'}`) + '\n';
    out += bold(false);

    if (item.note) out += '  Note: ' + clean(item.note) + '\n';
  }

  if (payload.note) {
    out += line(width);
    out += 'Order note: ' + clean(payload.note) + '\n';
  }

  out += line(width, '=');
  out += feed(3);
  out += cut();
  return Buffer.from(out, 'binary');
}

function buildText(job) {
  const type = String(job.type || '').toLowerCase();
  if (type.includes('kitchen') || type.includes('bar')) return buildKitchenTicket(job);
  return buildReceipt(job);
}

module.exports = {
  buildText,
  buildReceipt,
  buildKitchenTicket
};
