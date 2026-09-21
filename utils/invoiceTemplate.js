import { computeBilling } from './billing.js';

/** Escape user-supplied text before embedding it in the invoice HTML. */
const esc = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * Utility to generate a professional HTML invoice for bookings
 * Now includes automated PDF download functionality
 */
/**
 * Seller details. Overridable via env so a deployment can carry its real
 * registered address / GSTIN without a code change.
 */
const company = () => ({
    name: process.env.INVOICE_COMPANY_NAME || 'HOMEX',
    tagline: process.env.INVOICE_COMPANY_TAGLINE || 'Premium Home Services',
    address: process.env.INVOICE_COMPANY_ADDRESS || '123 Service Street, Tech City',
    phone: process.env.INVOICE_COMPANY_PHONE || '+91 98765 43210',
    email: process.env.INVOICE_COMPANY_EMAIL || 'support@homex.com',
    gstin: process.env.INVOICE_COMPANY_GSTIN || ''
});

const PAYMENT_METHOD_LABELS = {
    online: 'Online',
    cash: 'Cash on Service',
    wallet: 'Wallet',
    card: 'Card'
};

/** Blank / placeholder values fall back instead of printing an empty line. */
const or = (value, fallback = 'N/A') => {
    const text = String(value ?? '').trim();
    return !text || text === 'N/A' ? fallback : text;
};

/** Never print "Invalid Date" — return null so the caller can omit the row. */
const fmtDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
};

const fmtDateTime = (value) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('en-IN', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
};

/** 90 -> "1h 30m", 45 -> "45m". */
const fmtDuration = (minutes) => {
    const mins = Math.max(0, Math.round(Number(minutes) || 0));
    if (!mins) return null;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
};

/** One "<strong>Label:</strong> value" row, omitted entirely when empty. */
const row = (label, value) =>
    value ? `
                <p><strong>${esc(label)}:</strong> ${esc(value)}</p>` : '';

export const generateInvoiceHTML = (booking) => {
    const {
        bookingId = 'N/A',
        serviceName = 'General Service',
        serviceDescription = '',
        category = 'N/A',
        price = 0,
        duration = null,
        userName = 'Guest Customer',
        userEmail = '',
        userPhone = '',
        address = '',
        landmark = '',
        pincode = '',
        date = 'N/A',
        time = 'N/A',
        status = 'pending',
        statusLabel = '',
        paymentStatus = 'PENDING',
        paymentMethod = '',
        transactionId = '',
        paidAt = null,
        completedAt = null,
        technicianName = '',
        technicianPhone = '',
        customerNotes = '',
        createdAt = new Date(),
        extraServices = [],
        billing = null
    } = booking;

    const extras = Array.isArray(extraServices) ? extraServices : [];
    const seller = company();

    // Totals always come from the shared calculator so the invoice can never
    // disagree with the stored bill / payment summary. Persisted discount and
    // tax rate are honoured; base + extras are taken from the current data.
    const totals = computeBilling({ billing }, { baseAmount: price, extraServices: extras });

    const currency = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

    const formattedDate = fmtDate(date);
    const issuedDate = fmtDate(createdAt) || fmtDate(new Date());
    const paidOn = fmtDateTime(paidAt);
    const completedOn = fmtDateTime(completedAt);
    const serviceDuration = fmtDuration(duration);
    const isPaid = String(paymentStatus).toLowerCase() === 'paid';
    // Booking ids reach the PDF filename inside a JS string literal — keep it
    // to characters that are safe both in JS source and on a filesystem.
    const safeFileId = String(bookingId).replace(/[^A-Za-z0-9_-]/g, '') || 'booking';

    // Full postal address: street line, landmark and pincode each on their own row.
    const addressBlock = [or(address, ''), landmark ? `Landmark: ${landmark}` : '', pincode]
        .map((line) => String(line || '').trim())
        .filter(Boolean)
        .map((line) => esc(line))
        .join('<br>') || 'N/A';


    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice - ${esc(bookingId)}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            color: #333;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #ffffff;
        }
        #invoice-card {
            max-width: 800px;
            margin: 0 auto;
            background: #fff;
            padding: 40px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #eee;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .company-info h1 {
            margin: 0;
            color: #2563eb;
            font-size: 28px;
        }
        .company-info p {
            margin: 5px 0;
            color: #666;
        }
        .invoice-details {
            text-align: right;
        }
        .invoice-details h2 {
            margin: 0;
            color: #333;
            font-size: 24px;
        }
        .details-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            margin-bottom: 40px;
        }
        .section-title {
            font-weight: bold;
            text-transform: uppercase;
            color: #999;
            font-size: 12px;
            margin-bottom: 10px;
            border-bottom: 1px solid #eee;
            padding-bottom: 5px;
        }
        .info-block p {
            margin: 5px 0;
        }
        .info-block strong {
            color: #333;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
        }
        th {
            background-color: #f8fafc;
            text-align: left;
            padding: 12px;
            border-bottom: 2px solid #eee;
            color: #64748b;
            font-size: 13px;
            text-transform: uppercase;
        }
        td {
            padding: 15px 12px;
            border-bottom: 1px solid #eee;
        }
        .amount-col {
            text-align: right;
        }
        .totals {
            margin-left: auto;
            width: 300px;
        }
        .total-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
        }
        .total-row.grand-total {
            border-top: 2px solid #eee;
            margin-top: 10px;
            font-weight: bold;
            font-size: 18px;
            color: #2563eb;
        }
        .notes-block {
            clear: both;
            margin-top: 40px;
            padding-top: 10px;
        }
        .footer {
            margin-top: 50px;
            text-align: center;
            color: #999;
            font-size: 12px;
            border-top: 1px solid #eee;
            padding-top: 20px;
        }
        .status-stamp {
            display: inline-block;
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
        }
        .status-paid { background: #dcfce7; color: #166534; }
        .status-pending { background: #fef9c3; color: #854d0e; }
        
        .downloading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255,255,255,0.9);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .loader {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #2563eb;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin-bottom: 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="loader" class="downloading-overlay">
        <div class="loader"></div>
        <p>Generating PDF Invoice...</p>
    </div>

    <div id="invoice-card">
        <div class="header">
            <div class="company-info">
                <h1>${esc(seller.name)}</h1>
                <p>${esc(seller.tagline)}</p>
                <p>${esc(seller.address)}</p>
                <p>Phone: ${esc(seller.phone)}</p>
                <p>Email: ${esc(seller.email)}</p>${seller.gstin ? `
                <p>GSTIN: ${esc(seller.gstin)}</p>` : ''}
            </div>
            <div class="invoice-details">
                <h2>INVOICE</h2>
                <p>#${esc(bookingId)}</p>
                <p>Date Issued: ${esc(issuedDate)}</p>
                <div class="status-stamp status-${isPaid ? 'paid' : 'pending'}">
                    ${esc(String(paymentStatus).toUpperCase())}
                </div>
            </div>
        </div>

        <div class="details-grid">
            <div class="info-block">
                <div class="section-title">Billed To</div>
                <p><strong>${esc(userName)}</strong></p>
                <p>${esc(or(userEmail))}</p>
                <p>${esc(or(userPhone))}</p>
                <p>${addressBlock}</p>
            </div>
            <div class="info-block">
                <div class="section-title">Service Details</div>${row('Booking ID', bookingId)}${row('Service Date', formattedDate)}${row('Time Slot', or(time, ''))}${row('Duration', serviceDuration)}${row('Booking Status', statusLabel || status)}${row('Completed On', completedOn)}
            </div>
            <div class="info-block">
                <div class="section-title">Payment</div>${row('Status', String(paymentStatus).toUpperCase())}${row('Method', PAYMENT_METHOD_LABELS[String(paymentMethod).toLowerCase()] || paymentMethod)}${row('Transaction ID', transactionId)}${row('Paid On', paidOn)}
            </div>${technicianName ? `
            <div class="info-block">
                <div class="section-title">Service Professional</div>${row('Name', technicianName)}${row('Contact', technicianPhone)}
            </div>` : ''}
        </div>

        <table>
            <thead>
                <tr>
                    <th>Description</th>
                    <th>Category</th>
                    <th class="amount-col">Amount</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>
                        <strong>${esc(serviceName)}</strong><br>
                        <small style="color: #666">${esc(serviceDescription || `Professional home service provided by ${seller.name}`)}</small>
                    </td>
                    <td>${esc(or(category, 'General'))}</td>
                    <td class="amount-col">${currency(totals.baseAmount)}</td>
                </tr>${extras.map((item) => `
                <tr>
                    <td>
                        <strong>${esc(item.name)}</strong><span style="display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:#e6f7f2;color:#0f9d76;font-size:11px;font-weight:600;">EXTRA</span><br>
                        <small style="color: #666">${item.notes ? esc(item.notes) : 'Additional service performed during the visit'}${Number(item.quantity) > 1 ? ` &middot; ${Number(item.quantity)} × ${currency(item.unitPrice)}` : ''}</small>
                    </td>
                    <td>Extra Service</td>
                    <td class="amount-col">${currency(item.amount)}</td>
                </tr>`).join('')}
            </tbody>
        </table>

        <div class="totals">${totals.extrasTotal > 0 ? `
            <div class="total-row">
                <span>Service Charges</span>
                <span>${currency(totals.baseAmount)}</span>
            </div>
            <div class="total-row">
                <span>Extra Services (${extras.length})</span>
                <span>${currency(totals.extrasTotal)}</span>
            </div>` : ''}
            <div class="total-row">
                <span>Subtotal</span>
                <span>${currency(totals.subtotal)}</span>
            </div>${totals.discount > 0 ? `
            <div class="total-row">
                <span>Discount</span>
                <span>-${currency(totals.discount)}</span>
            </div>` : ''}
            <div class="total-row">
                <span>Tax (${totals.taxRate}%)</span>
                <span>${currency(totals.taxAmount)}</span>
            </div>
            <div class="total-row grand-total">
                <span>Total Amount</span>
                <span>${currency(totals.grandTotal)}</span>
            </div>
        </div>

${customerNotes ? `
        <div class="notes-block">
            <div class="section-title">Notes</div>
            <p style="white-space: pre-wrap; margin: 0;">${esc(customerNotes)}</p>
        </div>` : ''}

        <div class="footer">
            <p>Thank you for choosing ${esc(seller.name)} for your home needs!</p>
            <p>This is a computer-generated invoice and does not require a signature.</p>
        </div>
    </div>

    <script>
        window.onload = function() {
            const element = document.getElementById('invoice-card');
            const options = {
                margin: 10,
                filename: 'Invoice_${safeFileId}.pdf',
                image: { type: 'jpeg', quality: 0.95 },
                html2canvas: { scale: 1.5, useCORS: true, logging: false },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            // Generate and download PDF
            html2pdf().from(element).set(options).save().then(() => {
                document.getElementById('loader').innerHTML = '<p>✅ Download Complete! You can close this tab.</p>';
                // Optional: window.close(); 
            }).catch(err => {
                console.error('PDF error:', err);
                document.getElementById('loader').innerHTML = '<p>❌ Failed to generate PDF. Please use Ctrl+P to print.</p>';
            });
        };
    </script>
</body>
</html>
    `;
};
