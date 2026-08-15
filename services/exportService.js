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
