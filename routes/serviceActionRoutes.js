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
import { validateRequest } from '../middleware/validate.js';
import { extraServiceSchemas } from '../utils/validationSchemas.js';

const router = express.Router();

// GET routes for dashboard
router.get('/assigned', protect, getAssigned);
router.get('/pending', protect, getPending);
router.get('/completed', protect, getCompleted);
router.get('/in-progress', protect, getInProgress);

// Existing routes
router.get('/:id/quick-actions', getServiceQuickActions);
router.get('/:id/customer-contact', getCustomerContact);

// Action routes (using PUT to match frontend expectations)
router.put('/:id/confirm', protect, confirmService);
router.put('/:id/start', protect, startService);
router.put('/:id/complete', protect, completeService);
router.put('/:id/accept', protect, acceptAssignment);
router.put('/:id/status', protect, updateServiceStatus);
router.put('/:id/reschedule', protect, rescheduleService);

// Extra services (additional charges during an ongoing appointment).
// Guarded by `protect`; the controller additionally enforces that only the
// assigned employee (before the invoice is finalised) or an admin may modify.
router.get('/:id/extra-services', protect, getExtraServices);
router.post('/:id/extra-services', protect, validateRequest(extraServiceSchemas.create), addExtraService);
router.put('/:id/extra-services/:extraId', protect, validateRequest(extraServiceSchemas.update), updateExtraService);
router.delete('/:id/extra-services/:extraId', protect, removeExtraService);

// Backward compatibility for PATCH
router.patch('/:id/confirm', protect, confirmService);
router.patch('/:id/start', protect, startService);
router.patch('/:id/complete', protect, completeService);
router.patch('/:id/status', protect, updateServiceStatus);

export default router;