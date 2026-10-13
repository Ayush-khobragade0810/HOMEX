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
import { validate } from '../middleware/validate.js';
import * as v from '../validators/subscription.js';

const router = express.Router();

router.use(protect);

// Employee
router.get('/me', getMySubscription);
// Body is checked by validatePaymentRequest in the controller (field-keyed errors).
router.post('/me/request', submitPaymentRequest);
router.get('/me/ledger', validate({ query: v.ledgerQuery }), getMyLedger);
router.get('/me/open-jobs', getMyOpenJobs);

// Admin review
router.get('/admin/requests', authorize('admin'), validate({ query: v.listQuery }), listSubscriptions);
router.put('/admin/:employeeId/approve', authorize('admin'), validate({ params: v.employeeIdParams }), approvePayment);
router.put('/admin/:employeeId/reject', authorize('admin'), validate({ params: v.employeeIdParams, body: v.rejectBody }), rejectPayment);
router.get('/admin/:employeeId/ledger', authorize('admin'), validate({ params: v.employeeIdParams, query: v.ledgerQuery }), getEmployeeLedger);

export default router;
