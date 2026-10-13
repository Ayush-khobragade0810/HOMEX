import express from "express";
import {
    getServiceDetails,
    addServiceNote,
    getServiceNotes,
    updateServiceInfo,
    addSpecialRequirements,
    getServiceHistory,
    uploadAttachment,
    deleteServiceNote
} from "../controllers/serviceDetailController.js";
import { protect } from "../middleware/authMiddleware.js";
import { requireSubscriptionOrPaidJob } from "../middleware/subscriptionMiddleware.js";
import { validate } from "../middleware/validate.js";
import { serviceDetailParams, noteIdParams, serviceDetailSchemas as s } from "../validators/serviceAction.js";

const router = express.Router();

// `:serviceId` may be a legacy numeric Service id, a booking _id or a bookingId.
const params = (body) => validate({ params: serviceDetailParams, body });

// All of these expose or change customer/job data, so they need a logged-in
// caller (they were open to anyone). The employee dashboard calls them with
// its session, like the protected /service-actions routes.
// Registered before "/:serviceId" routes so "notes" is never read as an id.
router.delete("/notes/:noteId", protect, validate({ params: noteIdParams }), deleteServiceNote);

router.get("/:serviceId", protect, params(), getServiceDetails);
router.get("/:serviceId/notes", protect, params(), getServiceNotes);
router.get("/:serviceId/history", protect, params(), getServiceHistory);
router.post("/:serviceId/notes", protect, params(s.addNote), addServiceNote);
router.post("/:serviceId/requirements", protect, params(s.requirements), addSpecialRequirements);
router.post("/:serviceId/attachments", protect, params(), uploadAttachment);
// Changes job status/price, so it needs a logged-in caller (was open to anyone).
router.patch("/:serviceId", protect, params(s.updateInfo), requireSubscriptionOrPaidJob, updateServiceInfo);

export default router;
