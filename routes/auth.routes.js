import express from 'express';
import {
    register,
    login,
    loginLimiter,
    logout,
    getMe,
    refreshToken,
    revokeAllTokens,
    getProfile,
    updateProfile,
    changePassword
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js'; // Assuming middleware will be updated

const router = express.Router();

router.post('/signup', register);
router.post('/register', register); // For absolute consistency
router.post('/login', loginLimiter, login);
router.post('/employee-login', loginLimiter, (req, res, next) => {
    // Re-importing inside for safety if needed, though destructuring above is fine
    import('../controllers/authController.js').then(m => m.employeeLogin(req, res, next));
});
router.get('/logout', protect, logout);
router.get('/me', protect, getMe);

// New unified profile routes
router.get('/profile', protect, getProfile);
router.put('/profile', protect, updateProfile);
router.post('/change-password', protect, changePassword);

// TEMPORARY DEBUG ROUTE REMOVED

router.post('/refresh-token', refreshToken);
router.post('/revoke-all', protect, revokeAllTokens);

// Debug endpoint
router.post('/debug-signup', async (req, res) => {
    try {
        const User = (await import('../models/User.js')).default;
        const user = new User({
            email: req.body.email || `debug_${Date.now()}@test.com`,
            password: 'debugPassword123',
            name: 'Debug User',
            phone: '0000000000'
        });
        await user.save();
        res.json({ success: true, message: 'Debug user created', userId: user._id });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message, mongooseErrors: error.errors });
    }
});

export default router;
