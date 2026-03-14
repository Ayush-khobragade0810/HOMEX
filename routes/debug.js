import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = express.Router();

router.post('/fix-role', async (req, res) => {
    try {
        const { userId, newRole } = req.body;

        // Validate role
        const validRoles = ['admin', 'employee', 'user'];
        if (!validRoles.includes(newRole)) {
            return res.status(400).json({ error: 'Invalid role' });
        }

        // Update user in database
        const user = await User.findByIdAndUpdate(
            userId,
            { role: newRole },
            { new: true }
        ).select('-password');

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate new token with correct role
        const token = jwt.sign(
            { id: user._id, role: user.role, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: `Role updated to ${newRole}`,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role
            },
            token
        });

    } catch (error) {
        console.error('Fix role error:', error);
        res.status(500).json({ error: 'Failed to update role' });
    }
});

// Debug endpoint to check token and permissions
router.get('/check-auth', (req, res) => {
    console.log('🔍 DEBUG AUTH CHECK');
    console.log('Headers:', req.headers);
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.json({ authenticated: false, message: 'No authorization header' });
    }

    try {
        const token = authHeader.replace('Bearer ', '');
        // Decode without verification first
        const decoded = jwt.decode(token);
        // Then verify
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

        res.json({
            authenticated: true,
            user: verified,
            tokenInfo: {
                expires: new Date(verified.exp * 1000),
                role: verified.role
            }
        });

    } catch (error) {
        console.error('Token error:', error.message);
        res.status(401).json({ authenticated: false, error: error.message });
    }
});

export default router;
