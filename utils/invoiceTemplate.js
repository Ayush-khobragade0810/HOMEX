/**
 * Utility to generate a professional HTML invoice for bookings
 * Now includes automated PDF download functionality
 */
export const generateInvoiceHTML = (booking) => {
    const {
        bookingId = 'N/A',
        serviceName = 'General Service',
        category = 'N/A',
        price = 0,
        userName = 'Guest Customer',
        userEmail = 'N/A',
        userPhone = 'N/A',
        address = 'N/A',
        date = 'N/A',
        time = 'N/A',
        status = 'pending',
        paymentStatus = 'PENDING',
        createdAt = new Date()
    } = booking;

    const formattedDate = new Date(date).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const issuedDate = new Date(createdAt).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const amountStr = `₹${Math.round(price).toLocaleString('en-IN')}`;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice - ${bookingId}</title>
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
                <h1>HOMAX</h1>
                <p>Premium Home Services</p>
                <p>123 Service Street, Tech City</p>
                <p>Phone: +91 98765 43210</p>
                <p>Email: support@homax.com</p>
            </div>
            <div class="invoice-details">
                <h2>INVOICE</h2>
                <p>#${bookingId}</p>
                <p>Date Issued: ${issuedDate}</p>
                <div class="status-stamp status-${paymentStatus.toLowerCase() === 'paid' ? 'paid' : 'pending'}">
                    ${paymentStatus}
                </div>
            </div>
        </div>

        <div class="details-grid">
            <div class="info-block">
                <div class="section-title">Billed To</div>
                <p><strong>${userName}</strong></p>
                <p>${userEmail}</p>
                <p>${userPhone}</p>
                <p style="white-space: pre-wrap;">${address}</p>
            </div>
            <div class="info-block">
                <div class="section-title">Service Details</div>
                <p><strong>Booking ID:</strong> ${bookingId}</p>
                <p><strong>Service Date:</strong> ${formattedDate}</p>
                <p><strong>Time Slot:</strong> ${time}</p>
            </div>
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
                        <strong>${serviceName}</strong><br>
                        <small style="color: #666">Professional home service provided by Homax</small>
                    </td>
                    <td>${category}</td>
                    <td class="amount-col">${amountStr}</td>
                </tr>
            </tbody>
        </table>

        <div class="totals">
            <div class="total-row">
                <span>Subtotal</span>
                <span>${amountStr}</span>
            </div>
            <div class="total-row">
                <span>Tax (0%)</span>
                <span>₹0</span>
            </div>
            <div class="total-row grand-total">
                <span>Total Amount</span>
                <span>${amountStr}</span>
            </div>
        </div>

        <div class="footer">
            <p>Thank you for choosing Homax for your home needs!</p>
            <p>This is a computer-generated invoice and does not require a signature.</p>
        </div>
    </div>

    <script>
        window.onload = function() {
            const element = document.getElementById('invoice-card');
            const options = {
                margin: 10,
                filename: 'Invoice_${bookingId}.pdf',
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
