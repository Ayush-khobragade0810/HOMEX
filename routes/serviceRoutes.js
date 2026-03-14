import express from "express";
import {
    getEmployeeServices,
    updateServiceStatus,
    addServiceRating
} from "../controllers/serviceController.js";

const router = express.Router();

router.get("/employee/:empId", getEmployeeServices);
router.patch("/:id/status", updateServiceStatus);
router.post("/:id/rating", addServiceRating);

router.get('/rates', (req, res) => {
    res.json([
        { name: 'Plumbing', rate: 25, commission: 5, color: 'bg-blue-500' },
        { name: 'Electrical', rate: 30, commission: 7, color: 'bg-green-500' },
        { name: 'Cleaning', rate: 20, commission: 4, color: 'bg-purple-500' }
    ]);
});

export default router;