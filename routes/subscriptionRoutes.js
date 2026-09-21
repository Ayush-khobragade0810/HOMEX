import express from 'express';
import {
    getMySubscription,
    submitPaymentRequest,
    listSubscriptions,
    approvePayment,
    rejectPayment,
    getMyLedger,
    getEmployeeLedger,
    getMyOpenJobs
} from '../controllers/subscriptionController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

// Employee
router.get('/me', getMySubscription);
router.post('/me/request', submitPaymentRequest);
router.get('/me/ledger', getMyLedger);
router.get('/me/open-jobs', getMyOpenJobs);

// Admin review
router.get('/admin/requests', authorize('admin'), listSubscriptions);
router.put('/admin/:employeeId/approve', authorize('admin'), approvePayment);
router.put('/admin/:employeeId/reject', authorize('admin'), rejectPayment);
router.get('/admin/:employeeId/ledger', authorize('admin'), getEmployeeLedger);

export default router;
