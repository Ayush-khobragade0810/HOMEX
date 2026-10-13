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
import { validate } from "../middleware/validate.js";
import * as s from "../validators/admin.js";

const router = express.Router();

// Base URL for this router is '/api/employees' (defined in server.js)

// GET /api/employees
router.get("/", validate({ query: s.listEmployeesQuery }), searchEmployees);

// Profile and Top Technicians (Employee specific)
router.get("/profile", protect, getEmployeeProfile);
router.get("/top-technicians", protect, getTopTechnicians);

// Availability (the employee's own). Declared before "/:id" so the word
// "availability" is not treated as an employee id.
router.get("/availability", protect, getMyAvailability);
router.put("/availability", protect, updateMyAvailability);

// POST /api/employees
router.post("/", validate({ body: s.createEmployee }), createEmployee);

// PUT /api/employees/:id
// :id is the Mongo _id or the numeric empId.
router.put("/:id", validate({ params: s.employeeIdParam, body: s.updateEmployee }), updateEmployeeProfile);

// DELETE /api/employees/:id
router.delete("/:id", validate({ params: s.employeeIdParam }), deleteEmployee);

// Settings Routes (Imported from employeeController)
router.get("/:id/settings", protect, getEmployeeSettings);
router.put("/:id/settings", protect, updateEmployeeSettings);
router.post("/:id/deactivate", protect, deactivateAccount);

export default router;