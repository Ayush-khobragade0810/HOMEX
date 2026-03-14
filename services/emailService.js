import nodemailer from 'nodemailer';

// Create reusable transporter object using the default SMTP transport
const createTransporter = () => {
    // Check if SMTP credentials exists
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT || 587,
            secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }

    // Fallback or Dev mode: just log
    return null;
};

export const sendEmail = async ({ to, subject, text, html }) => {
    try {
        const transporter = createTransporter();

        if (!transporter) {
            console.log('⚠️ No SMTP credentials found. Email simulation:');
            console.log(`To: ${to}`);
            console.log(`Subject: ${subject}`);
            console.log(`Text: ${text}`);
            return { success: true, message: 'Email simulated (check console)' };
        }

        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"Homax Support" <no-reply@homax.com>',
            to,
            subject,
            text,
            html: html || text,
        });

        console.log("Message sent: %s", info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error("Error sending email: ", error);
        // Don't throw error to avoid crashing the main flow
        return { success: false, error: error.message };
    }
};

// Templates
export const getAssignmentEmailTemplate = (bookingId, serviceTitle, customerName) => {
    return {
        subject: `New Job Assignment: #${bookingId}`,
        html: `
            <h2>New Job Assigned via Homax</h2>
            <p>You have been assigned a new service request.</p>
            <ul>
                <li><strong>Booking ID:</strong> #${bookingId}</li>
                <li><strong>Service:</strong> ${serviceTitle}</li>
                <li><strong>Customer:</strong> ${customerName}</li>
            </ul>
            <p>Please check your dashboard for full details and to accept the job.</p>
        `
    };
};

export const getStatusUpdateEmailTemplate = (bookingId, status, notes) => {
    // Determine subject based on status
    let subject = `Update on Booking #${bookingId}`;
    if (status === 'COMPLETED') subject = `Booking #${bookingId} Marked as Completed`;
    if (status === 'CANCELLED') subject = `Booking #${bookingId} Cancelled`;

    return {
        subject: subject,
        html: `
            <h2>Booking Status Update</h2>
            <p>The status for booking <strong>#${bookingId}</strong> has been updated to:</p>
            <h3>${status}</h3>
            ${notes ? `<p><strong>Notes:</strong> ${notes}</p>` : ''}
            <p>Check your dashboard for more information.</p>
        `
    };
};
