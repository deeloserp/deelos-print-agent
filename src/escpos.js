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
  return num(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


function extractMoneyNumber(value) {
  const text = strip(value);
  if (!text) return '';

  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!matches || !matches.length) return '';

  return matches[matches.length - 1].replace(/,/g, '');
}

function moneyPlain(value, fallbackLabel) {
  const extracted = extractMoneyNumber(fallbackLabel);
  if (extracted !== '') return money(extracted);

  const fromValue = extractMoneyNumber(value);
  if (fromValue !== '') return money(fromValue);

  return money(value);
}


function moneyLabel(payload, value, fallbackLabel) {
  // Thermal printers can misread unsupported currency symbols.
  // Keep receipt amount rows numeric only.
  return moneyPlain(value, fallbackLabel);
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
  const amount = item.total_label || item.line_total_label || item.amount_label || null;
  const rawAmount = item.total ?? item.line_total ?? item.amount ?? item.line_total_cents;
  const right = moneyPlain(rawAmount, amount);

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



function fullCut(feedDots = 3) {
  const dots = Math.max(0, Math.min(255, Number(feedDots || 0)));
  return GS + 'V' + '\x41' + String.fromCharCode(dots);
}

function partialCut(feedDots = 3) {
  const dots = Math.max(0, Math.min(255, Number(feedDots || 0)));
  return GS + 'V' + '\x42' + String.fromCharCode(dots);
}

function barcodeCode128(value, options = {}) {
  let data = strip(value).replace(/[^\x20-\x7E]/g, '');
  if (!data) return '';

  // ESC/POS Code 128 requires an explicit code set. Code Set B covers
  // normal Deelos alphanumeric scan codes safely.
  if (!data.startsWith('{A') && !data.startsWith('{B') && !data.startsWith('{C')) {
    data = '{B' + data;
  }

  if (data.length > 255) data = data.slice(0, 255);

  const moduleWidth = Math.max(2, Math.min(6, Number(options.module_width || 2)));
  const height = Math.max(24, Math.min(180, Number(options.height || 56)));
  const hri = options.hri === true ? 2 : 0;

  let out = '';
  out += GS + 'w' + String.fromCharCode(moduleWidth);
  out += GS + 'h' + String.fromCharCode(height);
  out += GS + 'H' + String.fromCharCode(hri);
  out += GS + 'k' + String.fromCharCode(73) + String.fromCharCode(data.length) + data;
  out += '\n';
  return out;
}

function boolOption(options, key, fallback = false) {
  if (!options || !Object.prototype.hasOwnProperty.call(options, key)) return fallback;
  const value = options[key];
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function labelTypeName(value) {
  switch (String(value || '').toLowerCase()) {
    case 'price_tag': return 'PRICE TAG';
    case 'carton': return 'CARTON / PACK';
    case 'batch': return 'BATCH LABEL';
    case 'serial': return 'SERIAL ITEM';
    default: return 'PRODUCT LABEL';
  }
}

function buildProductLabels(job) {
  const payload = job.payload || {};
  const batch = payload.batch || {};
  const template = payload.template || {};
  const printOptions = payload.print_options || {};
  const display = template.display_options || batch.display_options || {};
  const items = Array.isArray(payload.items) ? payload.items : [];

  const paperSize = String(job.paper_size || printOptions.paper_size || template.fallback_paper_size || '80mm');
  const printerWidthMm = Number(template.printer_width_mm || template.label_width_mm || (paperSize.includes('58') ? 58 : 80));
  const width = printerWidthMm <= 58 ? 32 : 48;
  const labelHeightMm = Math.max(15, Number(template.label_height_mm || 30));
  const barcodeHeight = Math.max(32, Math.min(90, Math.round(labelHeightMm * 1.65)));

  const businessName = firstValue(payload, ['business.name', 'business_name', 'company_name']) || 'DEELOS ERP';
  const branchName = firstValue(payload, ['branch.name', 'branch_name']);
  const currency = firstValue(payload, ['currency', 'business.currency']) || 'GHS';

  const cutEach = boolOption(printOptions, 'cut_each_label', boolOption(template, 'cut_each_label', true));
  const cutMode = String(printOptions.cut_mode || (cutEach ? 'after_each_label' : 'after_batch')).toLowerCase();
  const cutType = String(printOptions.cut_type || 'full').toLowerCase();
  const feedBeforeCut = Math.max(0, Math.min(8, Number(printOptions.feed_before_cut ?? 3)));
  const feedAfterLabel = Math.max(0, Math.min(8, Number(printOptions.feed_after_label ?? 0)));

  const cutCommand = () => cutType === 'partial' ? partialCut(3) : fullCut(3);

  let out = init();

  items.forEach((item, itemIndex) => {
    const product = item.product || {};
    const copies = Math.max(1, Number(item.copies || 1));
    const scanCode = strip(item.scan_code || item.barcode_value || product.barcode || product.sku);

    for (let copyIndex = 0; copyIndex < copies; copyIndex++) {
      out += align('center');
      out += printMode(0);
      out += textSize(1, 1);

      if (boolOption(display, 'show_business_name', false)) {
        out += bold(true);
        out += clean(businessName).slice(0, width) + '\n';
        out += bold(false);
        if (branchName) out += clean(branchName).slice(0, width) + '\n';
      }

      if (boolOption(display, 'show_label_type', false)) {
        out += clean(labelTypeName(item.label_type || batch.label_type)) + '\n';
      }

      if (boolOption(display, 'show_product_name', true)) {
        out += bold(true);
        out += wrapText(product.name || 'Product', width, '');
        out += bold(false);
      }

      if (boolOption(display, 'show_brand', false) && product.brand) {
        out += clean('Brand: ' + product.brand).slice(0, width) + '\n';
      }

      if (boolOption(display, 'show_category', false) && product.category) {
        out += clean('Category: ' + product.category).slice(0, width) + '\n';
      }

      if (boolOption(display, 'show_sku', false) && product.sku) {
        out += clean('SKU: ' + product.sku).slice(0, width) + '\n';
      }

      if (boolOption(display, 'show_serial_no', false) && item.serial_no) {
        out += clean('Serial: ' + item.serial_no).slice(0, width) + '\n';
      }

      if (boolOption(display, 'show_carton_qty', false) && item.carton_qty) {
        out += bold(true);
        out += clean('PACK QTY: ' + item.carton_qty).slice(0, width) + '\n';
        out += bold(false);
      }

      if (boolOption(display, 'show_price', false)) {
        const cents = product.sale_price_cents != null
          ? Number(product.sale_price_cents || 0)
          : Number(product.price_cents || 0);
        out += bold(true);
        out += textSize(2, 2);
        out += clean(currency + ' ' + money(cents / 100)) + '\n';
        out += textSize(1, 1);
        out += bold(false);
      }

      if (scanCode) {
        out += align('center');
        out += barcodeCode128(scanCode, {
          module_width: printerWidthMm <= 58 ? 2 : 3,
          height: barcodeHeight,
          hri: false
        });

        if (boolOption(display, 'show_barcode_text', true)) {
          out += textSize(1, 1);
          out += clean(scanCode).slice(0, width) + '\n';
        }
      }

      if (feedAfterLabel > 0) out += feed(feedAfterLabel);

      const isLastPhysicalLabel = itemIndex === items.length - 1 && copyIndex === copies - 1;
      if (cutMode === 'after_each_label' || (cutMode === 'after_batch' && isLastPhysicalLabel)) {
        out += feed(feedBeforeCut);
        out += cutCommand();
      }
    }
  });

  if (!items.length) {
    out += align('center');
    out += bold(true) + 'NO LABEL ITEMS' + bold(false) + '\n';
    out += feed(3) + cutCommand();
  }

  return Buffer.from(out, 'utf8');
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
  const amountLabel = firstValue(tax, ['amount_label', 'tax_amount_label', 'total_label']);
  const amount = firstValue(tax, ['amount', 'tax_amount', 'total', 'amount_cents', 'tax_amount_cents']);

  let label = name;
  if (isPresent(rate) && !/\%/.test(label)) {
    label += ` (${num(rate).toString().replace(/\.0+$/, '')}%)`;
  }

  return {
    label,
    amount: moneyPlain(amount, amountLabel)
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
  out += labelValue('Subtotal', moneyPlain(payload.subtotal, firstValue(payload, ['subtotal_label'])), width);

  const discountValue = moneyPlain(payload.discount, firstValue(payload, ['discount_label']));
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
    out += columns('Tax', moneyPlain(payload.tax, firstValue(payload, ['tax_label'])), width);
  }

  const deliveryRaw = isPresent(payload.delivery) && num(payload.delivery) > 0
    ? payload.delivery
    : (isPresent(payload.delivery_fee) && num(payload.delivery_fee) > 0
      ? payload.delivery_fee
      : (isPresent(payload.delivery) ? payload.delivery : null));
  const deliveryCents = num(payload.delivery_fee_cents);
  const deliveryNumber = deliveryRaw !== null && num(deliveryRaw) > 0
    ? num(deliveryRaw)
    : deliveryCents / 100;
  const deliveryValue = moneyPlain(
    deliveryNumber,
    firstValue(payload, ['delivery_label', 'delivery_fee_label'])
  );
  if (deliveryNumber > 0 || payload.delivery_label || payload.delivery_fee_label) {
    out += columns('Delivery Fee', deliveryValue, width);
  }

  out += line(width, '=');
  const netTotalValue = moneyPlain(payload.net_total || payload.total || 0, firstValue(payload, ['net_total_label', 'total_label']));

  out += align('center');
  out += bold(true);
  out += textSize(2, 2);
  out += 'NET TOTAL\n';
  out += clean(netTotalValue) + '\n';
  out += textSize(1, 1);
  out += bold(false);
  out += align('left');

  if (payload.amount_paid != null || payload.amount_paid_label) {
    out += columns('Amount Paid', moneyPlain(payload.amount_paid, firstValue(payload, ['amount_paid_label'])), width);
  }

  if (payload.balance != null || payload.balance_label) {
    out += columns('Balance', moneyPlain(payload.balance, firstValue(payload, ['balance_label'])), width);
  }

  const trackingUrl = firstValue(payload, ['tracking_url', 'track_url', 'qr_text']);
  const qrText = firstValue(payload, ['qr_text', 'tracking_url', 'track_url', 'qr_code_url']);

  if (trackingUrl || qrText) {
    out += line(width);
    out += align('center');
    out += bold(true);
    // Use printer hardware center alignment only. Do not add manual spaces here.
    // Manual spaces plus ESC/POS center alignment can make this line look shifted.
    out += clean('') + '\n';// TRACK YOUR ORDER ONLINE
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

function receiptLayoutKey(job) {
  const payload = job && job.payload ? job.payload : {};
  const raw = payload.layout_id || payload.layout_key || payload.receipt_layout_key || payload.receipt_layout
    || job.layout_id || job.layout_key || 'classic_80mm';

  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_') || 'classic_80mm';
}

function receiptDelivery(payload) {
  const raw = isPresent(payload.delivery) && num(payload.delivery) > 0
    ? payload.delivery
    : (isPresent(payload.delivery_fee) && num(payload.delivery_fee) > 0
      ? payload.delivery_fee
      : (isPresent(payload.delivery) ? payload.delivery : null));
  const cents = num(payload.delivery_fee_cents);
  const value = raw !== null && num(raw) > 0 ? num(raw) : cents / 100;
  const label = firstValue(payload, ['delivery_label', 'delivery_fee_label']);

  return {
    value,
    label: moneyPlain(value, label),
    present: value > 0 || isPresent(label)
  };
}

function receiptTaxes(payload) {
  if (Array.isArray(payload.tax_lines)) return payload.tax_lines;
  if (Array.isArray(payload.taxes)) return payload.taxes;
  if (Array.isArray(payload.tax_breakdown)) return payload.tax_breakdown;
  return [];
}

function appendReceiptTotals(out, payload, width, options = {}) {
  const delivery = receiptDelivery(payload);
  const subtotal = moneyPlain(payload.subtotal, firstValue(payload, ['subtotal_label']));
  const discount = moneyPlain(payload.discount, firstValue(payload, ['discount_label']));
  const tax = moneyPlain(payload.tax, firstValue(payload, ['tax_label']));
  const netTotal = moneyPlain(payload.net_total || payload.total || 0, firstValue(payload, ['net_total_label', 'total_label']));

  out += labelValue('Subtotal', subtotal, width);

  if (num(payload.discount) > 0 || payload.discount_label) {
    out += columns('Discount', discount, width);
  }

  const taxes = receiptTaxes(payload);
  if (taxes.length) {
    if (!options.compact) out += line(width);
    out += bold(true) + 'TAXES\n' + bold(false);
    taxes.forEach(taxRow => {
      const row = normalizeTaxLine(taxRow, payload);
      out += columns(row.label, row.amount, width);
    });
  } else if (num(payload.tax) > 0 || payload.tax_label) {
    out += columns('Tax', tax, width);
  }

  if (delivery.present) {
    out += columns(options.deliveryLabel || 'Delivery Fee', delivery.label, width);
  }

  out += line(width, options.totalSeparator || '=');
  return { out, netTotal };
}

function appendReceiptPayments(out, payload, width) {
  if (payload.amount_paid != null || payload.amount_paid_label) {
    out += columns('Amount Paid', moneyPlain(payload.amount_paid, firstValue(payload, ['amount_paid_label'])), width);
  }

  if (payload.balance != null || payload.balance_label) {
    out += columns('Balance', moneyPlain(payload.balance, firstValue(payload, ['balance_label'])), width);
  }

  return out;
}

function buildStyledReceipt(job, style) {
  const payload = job.payload || {};
  const width = Number(payload.paper_width_chars || (String(job.paper_size || '').includes('58') ? 32 : 48));
  const businessName = firstValue(payload, ['business_name', 'company_name', 'business.name']) || 'DEELOS ERP';
  const businessPhone = firstValue(payload, ['business_phone', 'phone', 'business.phone']);
  const businessEmail = firstValue(payload, ['business_email', 'email', 'business.email']);
  const branchName = firstValue(payload, ['branch_name', 'branch.name']);
  const orderCode = firstValue(payload, ['order_code', 'order_id']);
  const date = firstValue(payload, ['date', 'created_at']);
  const server = firstValue(payload, ['server', 'cashier', 'operator']);
  const customerName = (firstValue(payload, ['customer_name']) || firstValue(payload, ['customer']) || 'WALK-IN').toString().toUpperCase();
  const customerPhone = firstValue(payload, ['customer_phone']);
  const customerAddress = firstValue(payload, ['customer_address']);
  const table = firstValue(payload, ['table', 'table_label']);
  const mode = firstValue(payload, ['mode', 'order_mode']);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const separator = style === 'minimal' ? '-' : (style === 'compact' ? '.' : '=');
  const compact = style === 'compact';
  let out = init();

  if (style === 'minimal') {
    out += align('left') + bold(true) + clean(businessName) + '\n' + bold(false);
    if (branchName) out += clean(branchName) + '\n';
  } else {
    out += align('center') + bold(true);
    out += textSize(style === 'bold_total' ? 2 : 1, style === 'bold_total' ? 2 : 1);
    out += clean(businessName) + '\n';
    out += textSize(1, 1) + bold(false);
    if (branchName) out += clean(branchName) + '\n';
    if (style !== 'compact') {
      if (businessPhone) out += clean(businessPhone) + '\n';
      if (businessEmail) out += clean(businessEmail) + '\n';
    }
  }

  out += align('left') + line(width, separator);
  out += bold(true);
  out += columns(style === 'delivery' ? 'DELIVERY RECEIPT' : (payload.subtitle || 'SALES RECEIPT'), orderCode, width);
  out += bold(false);

  if (date) out += columns('Date', date, width);
  if (server && style !== 'minimal') out += columns('Server/Cashier', server, width);
  if (customerName) out += columns('Customer', customerName, width);
  if (customerPhone) out += columns('Phone', customerPhone, width);
  if (style === 'delivery' && customerAddress) out += columns('Delivery To', customerAddress, width);
  if (table && style !== 'minimal') out += columns('Table', table, width);
  if (mode && style !== 'minimal') out += columns('Order Mode', mode, width);

  out += line(width, separator) + bold(true) + columns('ITEMS', 'TOTAL', width) + bold(false);
  for (const item of items) {
    out += itemLine(item, payload, width);
    if (item.note || item.line_note) out += wrapText('Note: ' + (item.note || item.line_note), width, '  ');
  }

  out += line(width, separator);
  const totals = appendReceiptTotals(out, payload, width, {
    compact,
    deliveryLabel: style === 'delivery' ? 'Delivery' : 'Delivery Fee',
    totalSeparator: separator
  });
  out = totals.out;

  if (style === 'bold_total') {
    out += align('center') + bold(true) + textSize(2, 2) + 'TOTAL\n' + clean(totals.netTotal) + '\n' + textSize(1, 1) + bold(false) + align('left');
  } else if (style === 'minimal') {
    out += bold(true) + columns('TOTAL', totals.netTotal, width) + bold(false);
  } else {
    out += align('center') + bold(true) + textSize(style === 'modern' ? 2 : 1, style === 'modern' ? 2 : 1);
    out += (style === 'delivery' ? 'AMOUNT DUE\n' : 'NET TOTAL\n') + clean(totals.netTotal) + '\n';
    out += textSize(1, 1) + bold(false) + align('left');
  }

  out = appendReceiptPayments(out, payload, width);

  const trackingUrl = firstValue(payload, ['tracking_url', 'track_url', 'qr_text']);
  const qrText = firstValue(payload, ['qr_text', 'tracking_url', 'track_url', 'qr_code_url']);
  if (qrText && style !== 'minimal') {
    out += line(width, separator) + align('center') + qrCode(qrText) + align('left');
  }

  if (trackingUrl && style === 'delivery') out += wrapText('Track: ' + trackingUrl, width);
  out += line(width, separator) + align('center') + bold(true) + clean(payload.footer || 'THANK YOU.') + '\n' + bold(false);
  out += clean(payload.powered_by || 'POWERED BY DEELOS ERP') + '\n' + feed(compact ? 2 : 3) + cut();

  return Buffer.from(out, 'utf8');
}

function buildReceiptByLayout(job) {
  switch (receiptLayoutKey(job)) {
    case 'modern_80mm':
      return buildStyledReceipt(job, 'modern');
    case 'compact_80mm':
      return buildStyledReceipt(job, 'compact');
    case 'delivery_80mm':
      return buildStyledReceipt(job, 'delivery');
    case 'minimal_80mm':
      return buildStyledReceipt(job, 'minimal');
    case 'bold_total_80mm':
      return buildStyledReceipt(job, 'bold_total');
    case 'classic_80mm':
    default:
      return buildReceipt(job);
  }
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

  if (type.includes('product_label') || type.includes('label_print') || type === 'label') {
    return buildProductLabels(job);
  }

  if (type.includes('kitchen') || type.includes('bar')) {
    return buildKitchenTicket(job);
  }

  return buildReceiptByLayout(job);
}

module.exports = {
  buildText,
  buildReceipt,
  buildReceiptByLayout,
  buildStyledReceipt,
  buildKitchenTicket,
  buildProductLabels
};
