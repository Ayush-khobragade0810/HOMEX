import { Parser } from 'json2csv';
import PDFDocument from 'pdfkit';
import logger from '../utils/logger.js';

class ExportService {
    async generateCSV(data) {
        try {
            const fields = [
                { label: 'Payment ID', value: 'paymentId' },
                { label: 'Date', value: 'date' },
                { label: 'Customer', value: 'customer.name' },
                { label: 'Service Type', value: 'serviceType' },
                { label: 'Hours', value: 'hours' },
                { label: 'Hourly Rate', value: 'hourlyRate' },
                { label: 'Total Amount', value: 'amount' },
                { label: 'Commission', value: 'commission' },
                { label: 'Net Earnings', value: 'baseRate' },
                { label: 'Bonus', value: 'bonus' },
                { label: 'Payment Method', value: 'paymentMethod' },
                { label: 'Status', value: 'status' },
                { label: 'Transaction ID', value: 'transactionId' },
            ];

            const json2csvParser = new Parser({ fields });
            const csv = json2csvParser.parse(data);

            return csv;
        } catch (error) {
            console.error('Error generating CSV:', error);
            throw error;
        }
    }

    async generatePDF(data, employeeInfo) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50 });
                const buffers = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => {
                    const pdfData = Buffer.concat(buffers);
                    resolve(pdfData);
                });

                // Header
                doc.fontSize(20).text('Employee Payment Report', { align: 'center' });
                doc.moveDown();
                doc.fontSize(12).text(`Generated on: ${new Date().toLocaleString()}`);
                doc.text(`Employee: ${employeeInfo.name || 'N/A'}`);
                doc.moveDown();

                // Table-like structure
                data.forEach((payment, index) => {
                    doc.fontSize(10).text(`Payment #${index + 1}`);
                    doc.text(`ID: ${payment._id}`);
                    doc.text(`Date: ${new Date(payment.date).toLocaleDateString()}`);
                    doc.text(`Status: ${payment.status}`);
                    doc.text(`Total Amount: $${payment.totalAmount}`);
                    doc.moveDown(0.5);
                    doc.rect(50, doc.y, 500, 1).fill('#cccccc');
                    doc.moveDown(0.5);
                });

                doc.end();

            } catch (error) {
                logger.error('Error generating PDF:', error);
                reject(error);
            }
        });
    }


    /**
     * Single-payment receipt PDF (used by the "Download Receipt" action
     * in the payment detail modal).
     */
    async generateReceipt(payment, employeeInfo = {}) {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ margin: 50, size: 'A4' });
                const buffers = [];

                doc.on('data', buffers.push.bind(buffers));
                doc.on('end', () => resolve(Buffer.concat(buffers)));
                doc.on('error', reject);

                const money = (n) => `INR ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                const teal = '#0d9488';
                const gray = '#64748b';
                const left = 50;
                const right = 545;

                // Header band
                doc.rect(0, 0, doc.page.width, 90).fill(teal);
                doc.fillColor('#ffffff').fontSize(22).text('Payment Receipt', left, 30);
                doc.fontSize(10).text('Homax Services', left, 60);
                doc.fillColor('#000000');

                doc.y = 120;

                const receiptNo = payment.transactionId
                    || (payment.paymentId ? `TRX-${payment.paymentId}` : `TRX-${String(payment._id || '').slice(-8)}`);

                doc.fontSize(10).fillColor(gray).text(`Receipt No: ${receiptNo}`, left, doc.y);
                doc.text(`Issued On: ${new Date().toLocaleString('en-IN')}`, left, doc.y);
                doc.text(`Payment Date: ${payment.date ? new Date(payment.date).toLocaleString('en-IN') : 'N/A'}`, left, doc.y);
                doc.text(`Status: ${String(payment.status || 'N/A').toUpperCase()}`, left, doc.y);
                doc.moveDown(1);

                // Section helper
                const section = (title, rows) => {
                    doc.fillColor(teal).fontSize(12).text(title, left, doc.y);
                    doc.moveDown(0.3);
                    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor('#e2e8f0').stroke();
                    doc.moveDown(0.5);

                    rows.forEach(([label, value]) => {
                        const y = doc.y;
                        doc.fillColor(gray).fontSize(10).text(label, left, y, { width: 200 });
                        doc.fillColor('#111827').fontSize(10)
                            .text(String(value ?? 'N/A'), left + 210, y, { width: right - left - 210, align: 'right' });
                        doc.moveDown(0.35);
                    });
                    doc.moveDown(0.8);
                };

                section('Employee', [
                    ['Name', employeeInfo.name || 'N/A'],
                    ['Employee ID', employeeInfo.empId ?? 'N/A'],
                    ['Email', employeeInfo.email || 'N/A']
                ]);

                section('Service', [
                    ['Service Type', payment.serviceType],
                    ['Duration', payment.hours != null ? `${payment.hours} hours` : 'N/A'],
                    ['Hourly Rate', money(payment.hourlyRate || (payment.hours ? payment.amount / payment.hours : 0))],
                    ['Customer', payment.customer?.name],
                    ['Location', payment.customer?.address]
                ]);

                section('Earnings Breakdown', [
                    ['Base Amount', money(payment.baseRate ?? payment.baseAmount)],
                    ['Commission', `- ${money(payment.commission)}`],
                    ['Bonus', money(payment.bonus)],
                    ['Tax', money(payment.tax)],
                    ['Tip', money(payment.tip)]
                ]);

                // Total band
                const totalY = doc.y;
                doc.rect(left, totalY, right - left, 34).fill('#f0fdfa');
                doc.fillColor(teal).fontSize(12).text('Total Earned', left + 12, totalY + 11);
                doc.fontSize(14).text(money(payment.totalAmount ?? payment.amount), left + 12, totalY + 9, {
                    width: right - left - 24,
                    align: 'right'
                });
                doc.y = totalY + 50;

                section('Payment Information', [
                    ['Payment Method', payment.paymentMethod],
                    ['Payment Gateway', payment.paymentGateway],
                    ['Transaction ID', receiptNo]
                ]);

                doc.fillColor(gray).fontSize(8)
                    .text('This is a computer generated receipt and does not require a signature.', left, doc.y, {
                        width: right - left,
                        align: 'center'
                    });

                doc.end();
            } catch (error) {
                logger.error('Error generating receipt PDF:', error);
                reject(error);
            }
        });
    }
    async generateExcel(data) {
        // Simplified Excel generation (CSV-like or JSON)
        const headers = [
            'Payment ID', 'Date', 'Customer', 'Service Type', 'Hours',
            'Hourly Rate', 'Total Amount', 'Commission', 'Net Earnings', 'Bonus',
            'Payment Method', 'Status', 'Transaction ID'
        ];

        const rows = data.map(payment => [
            payment.paymentId || payment._id,
            new Date(payment.date).toISOString(),
            payment.customer?.name || 'N/A',
            payment.serviceType,
            payment.hours,
            payment.hourlyRate,
            payment.amount,
            payment.commission,
            payment.baseRate,
            payment.bonus,
            payment.paymentMethod,
            payment.status,
            payment.transactionId || '',
        ]);

        return { headers, rows };
    }
}

export default new ExportService();
