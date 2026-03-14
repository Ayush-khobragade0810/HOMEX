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

const router = express.Router();

router.get("/:serviceId", getServiceDetails);
router.get("/:serviceId/notes", getServiceNotes);
router.get("/:serviceId/history", getServiceHistory);
router.post("/:serviceId/notes", addServiceNote);
router.post("/:serviceId/requirements", addSpecialRequirements);
router.post("/:serviceId/attachments", uploadAttachment);
router.patch("/:serviceId", updateServiceInfo);
router.delete("/notes/:noteId", deleteServiceNote);

export default router;