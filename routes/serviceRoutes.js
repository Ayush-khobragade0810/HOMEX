import express from "express";
import {
    getEmployeeServices,
    updateServiceStatus,
    addServiceRating
} from "../controllers/serviceController.js";
import { protect } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import { employeeParams, legacyServiceParams, legacyServiceSchemas as s } from "../validators/serviceAction.js";

const router = express.Router();

// Legacy Service records (numeric ids). These expose customer details and
// change job state, so they need a logged-in caller (were open to anyone);
// the controller limits employees to their own services.
router.get("/employee/:empId", protect, validate({ params: employeeParams, query: s.listQuery }), getEmployeeServices);
router.patch("/:id/status", protect, validate({ params: legacyServiceParams, body: s.updateStatus }), updateServiceStatus);
router.post("/:id/rating", protect, validate({ params: legacyServiceParams, body: s.rating }), addServiceRating);

router.get('/rates', (req, res) => {
    res.json([
        { name: 'Plumbing', rate: 25, commission: 5, color: 'bg-blue-500' },
        { name: 'Electrical', rate: 30, commission: 7, color: 'bg-green-500' },
        { name: 'Cleaning', rate: 20, commission: 4, color: 'bg-purple-500' }
    ]);
});

export default router;
