import express from 'express';
import mongoose from 'mongoose';
const router = express.Router();

// Simple test endpoint - no database, no logic
router.post('/test-booking', (req, res) => {
    console.log('🧪 TEST ENDPOINT HIT');
    console.log('Request body:', req.body);

    // Immediate response
    res.json({
        success: true,
        message: 'Test endpoint works',
        timestamp: new Date().toISOString(),
        data: req.body
    });
});

// Test with database but minimal
router.post('/test-db', async (req, res) => {
    console.log('🧪 DATABASE TEST ENDPOINT');

    try {
        // Just test connection
        const dbStatus = mongoose.connection.readyState;
        const statusMap = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting'
        };
        console.log('Database status:', dbStatus, statusMap[dbStatus]);

        res.json({
            success: true,
            dbConnected: dbStatus === 1,
            status: statusMap[dbStatus],
            message: 'Database test'
        });

    } catch (error) {
        console.error('Database test error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
