// routes/employeeRoutes.js
import express from 'express';
import {
    getProfile,
    getTopTechnicians,
    getEmployeeSettings,
    updateEmployeeSettings,
    deactivateAccount,
    updateProfile
} from '../controllers/employeeController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/profile', protect, getProfile);
router.get('/top-technicians', protect, getTopTechnicians);

// Settings Routes
router.get('/:id/settings', protect, getEmployeeSettings);
router.put('/:id/settings', protect, updateEmployeeSettings);
router.post('/:id/deactivate', protect, deactivateAccount);

// Profile Update Route (Self)
router.put('/:id', protect, updateProfile);

export default router;
