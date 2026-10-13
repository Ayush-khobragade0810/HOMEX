import express from 'express';
import {
    register,
    login,
    loginLimiter,
    employeeLogin,
    logout,
    getMe,
    refreshToken,
    revokeAllTokens,
    getProfile,
    updateProfile,
    changePassword
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js'; // Assuming middleware will be updated
import { validate } from '../middleware/validate.js';
import authSchemas from '../validators/auth.js';

const router = express.Router();

router.post('/signup', validate({ body: authSchemas.signup }), register);
router.post('/register', validate({ body: authSchemas.register }), register); // For absolute consistency
router.post('/login', loginLimiter, validate({ body: authSchemas.login }), login);
router.post('/employee-login', loginLimiter, validate({ body: authSchemas.employeeLogin }), employeeLogin);
router.get('/logout', protect, logout);
router.get('/me', protect, getMe);

// New unified profile routes
router.get('/profile', protect, getProfile);
router.put('/profile', protect, validate({ body: authSchemas.updateProfile }), updateProfile);
router.post('/change-password', protect, validate({ body: authSchemas.changePassword }), changePassword);

// TEMPORARY DEBUG ROUTE REMOVED

router.post('/refresh-token', validate({ body: authSchemas.refreshToken }), refreshToken);
router.post('/revoke-all', protect, revokeAllTokens);

// Debug endpoint
// NOTE: unauthenticated user creation - should be removed (or disabled) in production.
router.post('/debug-signup', async (req, res) => {
    try {
        const User = (await import('../models/User.js')).default;
        const user = new User({
            email: req.body?.email || `debug_${Date.now()}@test.com`,
            password: 'debugPassword123',
            name: 'Debug User',
            phone: '0000000000'
        });
        await user.save();
        res.status(201).json({ success: true, message: 'Debug user created', userId: user._id });
    } catch (error) {
        const message = error.code === 11000
            ? 'Email is already registered'
            : (error.message || 'Could not create debug user');
        res.status(400).json({ success: false, message, error: message, mongooseErrors: error.errors });
    }
});

export default router;
