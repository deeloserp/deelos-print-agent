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
    .replace(/[^\x09\x0A\x0D\x20-\x7E¢£¥€₵]/g, '');
}

function money(value) {
  const n = Number(value || 0);
  return n.toFixed(2);
}

function center(text, width = 42) {
  text = clean(text);
  if (text.length >= width) return text + '\n';

  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text + '\n';
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

function itemLine(name, qty, amount, width = 42) {
  const left = `${qty} x ${clean(name)}`;
  const right = amount == null ? '' : money(amount);
  return columns(left, right, width);
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

function cut() {
  return GS + 'V' + '\x41' + '\x03';
}

function feed(lines = 3) {
  return '\n'.repeat(lines);
}

function buildReceipt(job) {
  const payload = job.payload || {};
  const width = payload.paper_width_chars || (String(job.paper_size || '').includes('58') ? 32 : 42);

  let out = '';
  out += init();
  out += align('center');
  out += bold(true);
  out += center(payload.business_name || payload.company_name || 'DEELOS ERP', width);
  out += bold(false);

  if (payload.branch_name) out += center(payload.branch_name, width);
  if (payload.phone) out += center(payload.phone, width);

  out += align('left');
  out += line(width);
  out += columns('Receipt', payload.order_code || payload.order_id || '', width);
  if (payload.date) out += columns('Date', payload.date, width);
  if (payload.cashier) out += columns('Cashier', payload.cashier, width);
  if (payload.customer) out += columns('Customer', payload.customer, width);
  out += line(width);

  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const item of items) {
    out += itemLine(
      item.name || item.product_name || 'Item',
      item.qty || item.quantity || 1,
      item.total || item.line_total || item.amount,
      width
    );
  }

  out += line(width);

  if (payload.subtotal != null) out += columns('Subtotal', money(payload.subtotal), width);
  if (payload.discount != null) out += columns('Discount', money(payload.discount), width);
  if (payload.tax != null) out += columns('Tax', money(payload.tax), width);

  out += bold(true);
  out += columns('TOTAL', money(payload.total || payload.net_total || 0), width);
  out += bold(false);

  if (payload.amount_paid != null) out += columns('Paid', money(payload.amount_paid), width);
  if (payload.balance != null) out += columns('Balance', money(payload.balance), width);

  out += line(width);
  out += align('center');
  out += center(payload.footer || 'Thank you', width);
  out += feed(3);
  out += cut();

  return Buffer.from(out, 'binary');
}

function buildKitchenTicket(job) {
  const payload = job.payload || {};
  const width = payload.paper_width_chars || (String(job.paper_size || '').includes('58') ? 32 : 42);

  let out = '';
  out += init();
  out += align('center');
  out += bold(true);
  out += center(payload.title || 'KITCHEN TICKET', width);
  out += bold(false);
  out += align('left');
  out += line(width, '=');

  if (payload.order_code) out += columns('Order', payload.order_code, width);
  if (payload.table) out += columns('Table', payload.table, width);
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

  return Buffer.from(out, 'binary');
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
