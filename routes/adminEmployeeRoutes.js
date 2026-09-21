import express from "express";
import {
    searchEmployees,
    createEmployee,
    updateEmployeeProfile,
    deleteEmployee,
    getEmployeeProfile,
    getTopTechnicians
} from "../controllers/adminEmployeeController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
    getEmployeeSettings,
    getMyAvailability,
    updateMyAvailability,
    updateEmployeeSettings,
    deactivateAccount
} from "../controllers/employeeController.js";

const router = express.Router();

// Base URL for this router is '/api/employees' (defined in server.js)

// GET /api/employees
router.get("/", searchEmployees);

// Profile and Top Technicians (Employee specific)
router.get("/profile", protect, getEmployeeProfile);
router.get("/top-technicians", protect, getTopTechnicians);

// Availability (the employee's own). Declared before "/:id" so the word
// "availability" is not treated as an employee id.
router.get("/availability", protect, getMyAvailability);
router.put("/availability", protect, updateMyAvailability);

// POST /api/employees
router.post("/", createEmployee);

// PUT /api/employees/:id
router.put("/:id", updateEmployeeProfile);

// DELETE /api/employees/:id
router.delete("/:id", deleteEmployee);

// Settings Routes (Imported from employeeController)
router.get("/:id/settings", protect, getEmployeeSettings);
router.put("/:id/settings", protect, updateEmployeeSettings);
router.post("/:id/deactivate", protect, deactivateAccount);

export default router;