// src/escpos.js
'use strict';

const ESC = '\x1B';
const GS = '\x1D';

function line(width = 42, char = '-') {
  return char.repeat(width) + '\n';
}

function clean(value) {
  return String(value == null ? '' : value)
    .replace(/\r/g, '')
    .replace(/[^	\n\r\x20-\x7E¢£¥€₵]/g, '');
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

function currency(payload) {
  return strip(payload.currency || payload.currency_code || 'GHS') || 'GHS';
}

function currencySymbol(payload) {
  const symbol = strip(payload.currency_symbol || payload.currencySymbol || '');
  if (symbol) return symbol;

  const code = currency(payload).toUpperCase();
  return code === 'GHS' ? '₵' : '';
}

function moneyLabel(payload, value, fallbackLabel) {
  if (isPresent(fallbackLabel)) return strip(fallbackLabel);

  const text = strip(value);
  if (/^[A-Z]{3}\s+/i.test(text) || /^GHS\s+/i.test(text) || /^₵/.test(text)) {
    return text;
  }

  const symbol = currencySymbol(payload);
  return `${symbol || currency(payload)} ${money(value)}`;
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

function itemLine(item, payload, width = 42) {
  const qty = item.qty || item.quantity || 1;
  const name = strip(item.name || item.product_name || item.description || 'Item');
  const amount = item.total_symbol_label || item.line_total_symbol_label || item.amount_symbol_label || item.total_label || item.line_total_label || item.amount_label || null;
  const rawAmount = item.total ?? item.line_total ?? item.amount ?? item.line_total_cents;
  const right = amount ? strip(amount) : moneyLabel(payload, rawAmount, null);

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

  // ESC/POS QR Code: model 2, size 6, medium correction, store data, print.
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

function normalizeTaxLine(tax, payload) {
  const name = strip(tax.name || tax.tax_name || tax.label || tax.tax_code || tax.code || 'Tax');
  const rate = firstValue(tax, ['rate', 'tax_rate', 'rate_pct', 'percentage']);
  const amountLabel = firstValue(tax, ['amount_symbol_label', 'tax_amount_symbol_label', 'total_symbol_label', 'amount_label', 'tax_amount_label', 'total_label']);
  const amount = firstValue(tax, ['amount', 'tax_amount', 'total', 'amount_cents', 'tax_amount_cents']);

  let label = name;
  if (isPresent(rate) && !/\%/.test(label)) {
    label += ` (${num(rate).toString().replace(/\.0+$/, '')}%)`;
  }

  return {
    label,
    amount: amountLabel ? strip(amountLabel) : moneyLabel(payload, amount, null)
  };
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

  let out = '';
  out += init();

  // Centered professional business header.
  out += align('center');
  out += bold(true);
  out += textSize(2, 2);
  out += clean(businessName) + '\n';
  out += textSize(1, 1);
  out += bold(false);

  // Keep the business meta centered by printer alignment, not manual spacing.
  // This keeps the header block visually centered like the NET TOTAL block.
  if (businessPhone) out += clean(businessPhone) + '\n';
  if (businessEmail) out += clean(businessEmail) + '\n';
  if (businessWebsite) out += clean(businessWebsite) + '\n';
  if (branchName) out += clean(branchName) + '\n';

  out += align('left');

  out += line(width, '=');
  out += bold(true);
  out += columns(payload.title || 'SALES RECEIPT', orderCode, width);
  out += bold(false);
  if (date) out += columns('Date', date, width);
  if (server) out += columns('Server/Cashier', server, width);
  if (customerName) out += columns('Customer', customerName, width);
  if (customerPhone) out += columns('Phone', customerPhone, width);
  if (table) out += columns('Table', table, width);
  if (mode) out += columns('Order Mode', mode, width);

  out += line(width);
  out += bold(true);
  out += columns('ITEMS', 'TOTAL', width);
  out += bold(false);

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    out += itemLine(item, payload, width);

    if (item.note || item.line_note) {
      out += wrapText('Note: ' + (item.note || item.line_note), width, '  ');
    }
  }

  out += line(width);
  out += labelValue('Subtotal', firstValue(payload, ['subtotal_symbol_label', 'subtotal_label']) || moneyLabel(payload, payload.subtotal, null), width);

  const discountValue = firstValue(payload, ['discount_symbol_label', 'discount_label']) || moneyLabel(payload, payload.discount, null);
  if (num(payload.discount) > 0 || payload.discount_label) out += columns('Discount', discountValue, width);

  const taxes = Array.isArray(payload.tax_lines) ? payload.tax_lines
    : Array.isArray(payload.taxes) ? payload.taxes
    : Array.isArray(payload.tax_breakdown) ? payload.tax_breakdown
    : [];

  if (taxes.length) {
    out += line(width);
    out += bold(true);
    out += 'TAXES\n';
    out += bold(false);

    taxes.forEach(tax => {
      const row = normalizeTaxLine(tax, payload);
      out += columns(row.label, row.amount, width);
    });
  } else if (num(payload.tax) > 0 || payload.tax_label) {
    out += columns('Tax', firstValue(payload, ['tax_symbol_label', 'tax_label']) || moneyLabel(payload, payload.tax, null), width);
  }

  const deliveryValue = firstValue(payload, ['delivery_symbol_label', 'delivery_fee_symbol_label', 'delivery_label', 'delivery_fee_label']) || moneyLabel(payload, payload.delivery || payload.delivery_fee, null);
  if (num(payload.delivery || payload.delivery_fee) > 0 || payload.delivery_label || payload.delivery_fee_label) {
    out += columns('Delivery Fee', deliveryValue, width);
  }

  out += line(width, '=');
  const netTotalValue = firstValue(payload, ['net_total_symbol_label', 'total_symbol_label', 'net_total_label', 'total_label']) || moneyLabel(payload, payload.net_total || payload.total || 0, null);

  out += align('center');
  out += bold(true);
  out += textSize(2, 2);
  out += 'NET TOTAL\n';
  out += clean(netTotalValue) + '\n';
  out += textSize(1, 1);
  out += bold(false);
  out += align('left');

  if (payload.amount_paid != null || payload.amount_paid_label) {
    out += columns('Amount Paid', firstValue(payload, ['amount_paid_symbol_label', 'amount_paid_label']) || moneyLabel(payload, payload.amount_paid, null), width);
  }

  if (payload.balance != null || payload.balance_label) {
    out += columns('Balance', firstValue(payload, ['balance_symbol_label', 'balance_label']) || moneyLabel(payload, payload.balance, null), width);
  }

  const trackingUrl = firstValue(payload, ['tracking_url', 'track_url', 'qr_text']);
  const qrText = firstValue(payload, ['qr_text', 'tracking_url', 'track_url', 'qr_code_url']);

  if (trackingUrl || qrText) {
    out += line(width);
    out += align('center');
    out += bold(true);
    // Use printer hardware center alignment only. Do not add manual spaces here.
    // Manual spaces plus ESC/POS center alignment can make this line look shifted.
    out += clean('TRACK YOUR ORDER ONLINE') + '\n';
    out += bold(false);

    if (qrText) {
      out += feed(1);
      out += qrCode(qrText);
      out += feed(1);
    }

    out += align('left');
  }

  out += line(width);
  out += align('center');
  out += bold(true);
  out += clean(payload.footer || 'THANK YOU.') + '\n';
  out += bold(false);
  out += clean(payload.powered_by || 'POWERED BY DEELOS ERP') + '\n';
  out += feed(3);
  out += cut();

  return Buffer.from(out, 'utf8');
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

    if (item.note) {
      out += '  Note: ' + clean(item.note) + '\n';
    }
  }

  if (payload.note) {
    out += line(width);
    out += 'Order note: ' + clean(payload.note) + '\n';
  }

  out += line(width, '=');
  out += feed(3);
  out += cut();

  return Buffer.from(out, 'utf8');
}

function buildText(job) {
  const type = String(job.type || '').toLowerCase();

  if (type.includes('kitchen') || type.includes('bar')) {
    return buildKitchenTicket(job);
  }

  return buildReceipt(job);
}

module.exports = {
  buildText,
  buildReceipt,
  buildKitchenTicket
};
