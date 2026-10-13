// import express from "express";
// import {
//     confirmService,
//     startService,
//     completeService,
//     getCustomerContact,
//     updateServiceStatus,
//     getServiceQuickActions,
//     rescheduleService,
//     getAssignedServices,
//     getPendingAssignments,
//     getCompletedServices,
//     acceptAssignment
// } from "../controllers/serviceActionsController.js";
// import { protect } from "../middleware/auth.js";

// const router = express.Router();

// // GET routes for dashboard
// router.get("/assigned", protect, getAssignedServices);
// router.get("/pending", protect, getPendingAssignments);
// router.get("/completed", protect, getCompletedServices);

// // Existing routes
// router.get("/:serviceId/quick-actions", getServiceQuickActions);
// router.get("/:serviceId/customer-contact", getCustomerContact);

// // Action routes (using PUT to match frontend expectations)
// router.put("/:serviceId/confirm", protect, confirmService);
// router.put("/:serviceId/start", protect, startService);
// router.put("/:serviceId/complete", protect, completeService);
// router.put("/:serviceId/accept", protect, acceptAssignment);
// router.put("/:serviceId/status", protect, updateServiceStatus);
// router.put("/:serviceId/reschedule", protect, rescheduleService);

// // Backward compatibility for PATCH
// router.patch("/:serviceId/confirm", protect, confirmService);
// router.patch("/:serviceId/start", protect, startService);
// router.patch("/:serviceId/complete", protect, completeService);
// router.patch("/:serviceId/status", protect, updateServiceStatus);

// export default router;
// routes/serviceActionRoutes.js

// routes/serviceActionRoutes.js
import express from 'express';
import {
  getAssigned,
  getPending,
  getCompleted,
  getInProgress,
  confirmService,
  startService,
  completeService,
  acceptAssignment,
  getCustomerContact,
  updateServiceStatus,
  getServiceQuickActions,
  rescheduleService,
  getExtraServices,
  addExtraService,
  updateExtraService,
  removeExtraService
} from '../controllers/serviceActionController.js';
import { protect } from '../middleware/authMiddleware.js';
import { requireActiveSubscription, requireSubscriptionOrPaidJob } from '../middleware/subscriptionMiddleware.js';
import { validate } from '../middleware/validate.js';
import {
  jobIdParams,
  legacyServiceParams,
  extraServiceParams,
  extraServiceSchemas,
  serviceActionSchemas as s
} from '../validators/serviceAction.js';

const router = express.Router();

// Job ids may be a booking _id, a human bookingId or a legacy Service id.
const job = (body) => validate({ params: jobIdParams, body });
const legacy = (body) => validate({ params: legacyServiceParams, body });

// GET routes for dashboard
router.get('/assigned', protect, requireActiveSubscription, getAssigned);
router.get('/pending', protect, requireActiveSubscription, getPending);
router.get('/completed', protect, requireActiveSubscription, getCompleted);
router.get('/in-progress', protect, requireActiveSubscription, getInProgress);

// Legacy Service lookups (numeric serviceId). These return customer contact
// details, so they need a logged-in caller (were open to anyone).
router.get('/:id/quick-actions', protect, legacy(), getServiceQuickActions);
router.get('/:id/customer-contact', protect, legacy(), getCustomerContact);

// Action routes (using PUT to match frontend expectations)
router.put('/:id/confirm', protect, job(s.accept), requireActiveSubscription, confirmService);
router.put('/:id/start', protect, job(s.start), requireSubscriptionOrPaidJob, startService);
router.put('/:id/complete', protect, job(s.complete), requireSubscriptionOrPaidJob, completeService);
router.put('/:id/accept', protect, job(s.accept), requireActiveSubscription, acceptAssignment);
router.put('/:id/status', protect, job(s.status), requireSubscriptionOrPaidJob, updateServiceStatus);
router.put('/:id/reschedule', protect, legacy(s.reschedule), requireSubscriptionOrPaidJob, rescheduleService);

// Extra services (additional charges during an ongoing appointment).
// Guarded by `protect`; the controller additionally enforces that only the
// assigned employee (before the invoice is finalised) or an admin may modify.
router.get('/:id/extra-services', protect, job(), requireSubscriptionOrPaidJob, getExtraServices);
router.post('/:id/extra-services', protect, job(extraServiceSchemas.create), requireSubscriptionOrPaidJob, addExtraService);
router.put('/:id/extra-services/:extraId', protect, validate({ params: extraServiceParams, body: extraServiceSchemas.update }), requireSubscriptionOrPaidJob, updateExtraService);
router.delete('/:id/extra-services/:extraId', protect, validate({ params: extraServiceParams }), requireSubscriptionOrPaidJob, removeExtraService);

// Backward compatibility for PATCH
router.patch('/:id/confirm', protect, job(s.accept), requireActiveSubscription, confirmService);
router.patch('/:id/start', protect, job(s.start), requireSubscriptionOrPaidJob, startService);
router.patch('/:id/complete', protect, job(s.complete), requireSubscriptionOrPaidJob, completeService);
router.patch('/:id/status', protect, job(s.status), requireSubscriptionOrPaidJob, updateServiceStatus);

export default router;
