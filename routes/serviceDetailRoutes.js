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

const router = express.Router();

router.get("/:serviceId", getServiceDetails);
router.get("/:serviceId/notes", getServiceNotes);
router.get("/:serviceId/history", getServiceHistory);
router.post("/:serviceId/notes", addServiceNote);
router.post("/:serviceId/requirements", addSpecialRequirements);
router.post("/:serviceId/attachments", uploadAttachment);
// Changes job status/price, so it needs a logged-in caller (was open to anyone).
router.patch("/:serviceId", protect, requireSubscriptionOrPaidJob, updateServiceInfo);
router.delete("/notes/:noteId", deleteServiceNote);

export default router;