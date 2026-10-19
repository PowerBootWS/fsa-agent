// The one sign-off and company footer for every email sent from support@.
//
// Only the greeting and body change from message to message; the closing,
// Olivia's signature and the address block are fixed here. Same wording as
// fsa-customer-support/email_template.py and the address in
// fsa-nurture/lib/footer.js: change all three together. No em dashes: they
// read as machine-written, and this text goes to customers.

const ADDRESS = 'PO Box 99900 EU 953 098 RPO SKYVIEW, EDMONTON, ALBERTA T5L2Y2';
const PHONE = '+1-587-412-5264';
const CLOSING = 'Warm regards,';
const SIGNATURE = ['Olivia', 'Customer Support Agent', 'Full Steam Ahead'];
const CONTACT = `${PHONE} | support@fullsteamahead.ca | fullsteamahead.ca`;
const FOOTER_TEXT = ['--', 'Full Steam Ahead', ADDRESS, CONTACT].join('\n');

function signText(body) {
  const text = String(body || '').trim();
  if (text.includes(ADDRESS)) return text;
  return [text, CLOSING, SIGNATURE.join('\n'), FOOTER_TEXT].filter(Boolean).join('\n\n');
}

function signHtml(body) {
  const html = String(body || '').trim();
  if (html.includes(ADDRESS)) return html;
  return html +
    `<p>${CLOSING}</p>` +
    `<p>${SIGNATURE.join('<br>')}</p>` +
    '<hr style="border:none;border-top:1px solid #ccc;margin:2em 0 1em">' +
    '<p style="font-size:12px;color:#666;line-height:1.6">Full Steam Ahead<br>' +
    `${ADDRESS}<br>${PHONE} | ` +
    '<a href="mailto:support@fullsteamahead.ca" style="color:#666">support@fullsteamahead.ca</a> | ' +
    '<a href="https://fullsteamahead.ca" style="color:#666">fullsteamahead.ca</a></p>';
}

module.exports = { ADDRESS, PHONE, CLOSING, SIGNATURE, FOOTER_TEXT, signText, signHtml };
