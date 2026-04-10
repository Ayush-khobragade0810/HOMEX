import mongoose from "mongoose";
import Employee from "../models/adminEmployee.js";
import Booking from "../models/Booking.js";
import { cache } from "../utils/helpers.js";

/**
 * @desc    Search and list employees with aggregated stats
 * @route   GET /api/employees
 * @access  Private/Admin
 */
export const searchEmployees = async (req, res) => {
    try {
        console.log("SEARCH EMPLOYEES: Attempting to find employees...");

        // Build query based on status param
        const query = {};
        let statusFilter = '';
        if (req.query.status) {
            // Sanitize status to prevent Regex Injection
            statusFilter = String(req.query.status).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.status = { $regex: new RegExp(`^${statusFilter}$`, 'i') };
        }

        const cacheKey = `employees_list_${statusFilter || 'all'}`;
        const cachedResults = cache.get(cacheKey);
        if (cachedResults) {
            console.log("🚀 Serving employees list from cache");
            return res.json(cachedResults);
        }

        const employees = await Employee.find(query).select('-avatar').lean();
        console.log(`SEARCH EMPLOYEES: Found ${employees.length} records.`);
        if (employees.length === 0) {
            cache.set(cacheKey, [], 30000); // Cache empty result for 30s
            return res.json([]);
        }

        const employeeIds = employees.map(e => e._id);

        // Run aggregations in parallel to avoid sequential blocking
        const [earningsStats, currentTaskStats] = await Promise.all([
            Booking.aggregate([
                { 
                    $match: { 
                        "assignedTo.technicianId": { $in: employeeIds }, 
                        status: { $in: ["completed", "COMPLETED", "Completed"] } 
                    } 
                },
                { 
                    $group: { 
                        _id: "$assignedTo.technicianId", 
                        total: { 
                            $sum: { 
                                $ifNull: ["$payment.amount", { $ifNull: ["$serviceDetails.price", 0] }] 
                            } 
                        } 
                    } 
                }
            ]),

            // 2. Efficiently find the latest active task per employee
            Booking.aggregate([
                { 
                    $match: { 
                        "assignedTo.technicianId": { $in: employeeIds }, 
                        status: { $in: ['assigned', 'ASSIGNED', 'in_progress', 'IN_PROGRESS', 'navigating', 'NAVIGATING', 'started', 'STARTED', 'ACCEPTED', 'Accepted', 'Confirmed', 'confirmed'] } 
                    } 
                },
                { $sort: { updatedAt: -1 } },
                { 
                    $group: { 
                        _id: "$assignedTo.technicianId", 
                        latestTask: { $first: "$$ROOT" } 
                    } 
                }
            ])
        ]);

        // Create fast lookup maps
        const earningsMap = {};
        earningsStats.forEach(stat => {
            if (stat._id) earningsMap[stat._id.toString()] = stat.total;
        });

        const taskMap = {};
        currentTaskStats.forEach(stat => {
            if (stat._id) taskMap[stat._id.toString()] = stat.latestTask;
        });

        // Format employees with aggregated data
        const formattedEmployees = employees.map(emp => {
            const techIdStr = emp._id.toString();
            const totalEarnings = earningsMap[techIdStr] || 0;
            const currentTask = taskMap[techIdStr];

            return {
                _id: emp._id,
                id: emp.empId,
                name: emp.empName,
                nameDisplay: emp.empName, // Compatibility
                email: emp.email,
                phone: emp.phone,
                role: emp.role,
                earnings: totalEarnings || emp.earnings || 0,
                status: emp.status,
                avatar: emp.avatar,
                countryId: emp.countryId,
                stateId: emp.stateId,
                cityId: emp.cityId,
                areaId: emp.areaId,
                currentTask: currentTask ? {
                    bookingId: currentTask.bookingId,
                    serviceName: currentTask.serviceDetails?.title || currentTask.serviceName || "Service",
                    status: currentTask.status.toLowerCase() === 'in_progress' ? 'In Progress' : currentTask.status,
                    customerName: currentTask.contactIdInfo?.fullName || currentTask.contactInfo?.fullName || "Customer",
                    customerPhone: currentTask.contactIdInfo?.phoneNumber || currentTask.contactInfo?.phoneNumber || "N/A",
                    date: currentTask.schedule?.preferredDate,
                    time: currentTask.schedule?.timeSlot,
                    location: currentTask.location?.completeAddress || currentTask.location?.address || "N/A"
                } : null
            };
        });

        // Cache for 60 seconds to reduce DB load
        cache.set(cacheKey, formattedEmployees, 60000);

        res.json(formattedEmployees);
    } catch (err) {
        console.error("❌ EMPLOYEE API ERROR (searchEmployees):", {
            message: err.message,
            stack: err.stack,
            query: req.query
        });
        res.status(500).json({ 
            success: false, 
            message: "Failed to load employee list",
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

/**
 * @desc    Get profile for logged in employee
 * @route   GET /api/employees/profile
 * @access  Private
 */
export const getEmployeeProfile = async (req, res) => {
    try {
        console.log("Employee profile request for:", req.user?.email);

        if (!req.user?.email) {
            return res.status(400).json({ message: "Invalid user data - email missing" });
        }

        let employee = await Employee.findOne({ email: req.user.email });

        // Auto-create Employee record if it doesn't exist
        if (!employee) {
            console.log(`📝 Employee record not found for ${req.user.email}, creating one...`);
            employee = new Employee({
                empName: req.user.name || "Employee",
                email: req.user.email,
                phone: "",
                role: "Service Technician",
                countryId: 1,
                stateId: 1,
                cityId: 1,
                areaId: 1,
                earnings: 0,
                status: "Active",
                bio: "",
                specialties: [],
                certifications: [],
                rating: 0,
                completedJobs: 0
            });
            await employee.save();
        }

        const profile = {
            id: employee.empId,
            _id: employee._id,
            name: employee.empName,
            email: employee.email,
            phone: employee.phone,
            role: employee.role,
            earnings: employee.earnings || 0,
            avatar: employee.avatar || 'DP',
            joinDate: employee.joinDate,
            bio: employee.bio,
            rating: employee.rating || 0,
            completedJobs: employee.completedJobs || 0,
            statistics: employee.statistics || { totalEarnings: 0, hoursWorked: 0 }
        };

        res.json(profile);
    } catch (err) {
        console.error("Error in getEmployeeProfile:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * @desc    Get top technicians for dashboard
 * @route   GET /api/employees/top-technicians
 * @access  Private/Admin
 */
export const getTopTechnicians = async (req, res) => {
    try {
        const technicians = await Employee.find({ status: 'Active' })
            .sort({ rating: -1 })
            .limit(5);

        const formatted = technicians.map((tech, index) => ({
            id: tech.empId,
            rank: index + 1,
            name: tech.empName,
            rating: tech.rating || 0,
            jobs: tech.completedJobs || 0,
            earnings: tech.earnings || 0
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * @desc    Create new employee
 * @route   POST /api/employees
 * @access  Private/Admin
 */
export const createEmployee = async (req, res) => {
    try {
        const { name, email, phone, role, earnings, status, countryId, stateId, cityId, areaId } = req.body;

        const newEmployee = new Employee({
            empName: name,
            email,
            phone,
            role,
            earnings,
            status,
            countryId,
            stateId,
            cityId,
            areaId,
            avatar: name ? name.split(' ').map(n => n[0]).join('').toUpperCase() : "DP"
        });

        const savedEmployee = await newEmployee.save();
        res.status(201).json(savedEmployee);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

/**
 * @desc    Update employee profile
 * @route   PUT /api/employees/:id
 * @access  Private/Admin
 */
export const updateEmployeeProfile = async (req, res) => {
    try {
        const {
            name, empName, email, phone, role, earnings, status,
            countryId, stateId, cityId, areaId,
            bio, specialties, certifications, address, avatar,
            settings
        } = req.body;

        const updateData = {};
        if (name || empName) updateData.empName = name || empName;
        if (email) updateData.email = email;
        if (phone) updateData.phone = phone;
        if (role) updateData.role = role;
        if (earnings !== undefined) updateData.earnings = earnings;
        if (status) updateData.status = status;
        if (countryId) updateData.countryId = countryId;
        if (stateId) updateData.stateId = stateId;
        if (cityId) updateData.cityId = cityId;
        if (areaId) updateData.areaId = areaId;
        if (bio !== undefined) updateData.bio = bio;
        if (address !== undefined) updateData.address = address;
        if (specialties !== undefined) updateData.specialties = specialties;
        if (certifications !== undefined) updateData.certifications = certifications;
        if (avatar) updateData.avatar = avatar;
        if (settings) updateData.settings = settings;

        const idParam = req.params.id;
        let queryObj;
        if (mongoose.Types.ObjectId.isValid(idParam) && new mongoose.Types.ObjectId(idParam).toString() === idParam) {
            queryObj = { _id: idParam };
        } else {
            queryObj = { empId: parseInt(idParam) };
        }

        const employee = await Employee.findOneAndUpdate(
            queryObj,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!employee) return res.status(404).json({ message: "Employee not found" });
        res.json(employee);
    } catch (err) {
        console.error("Update Profile Error:", err);
        res.status(400).json({ error: err.message });
    }
};

/**
 * @desc    Delete employee
 * @route   DELETE /api/employees/:id
 * @access  Private/Admin
 */
export const deleteEmployee = async (req, res) => {
    try {
        const idParam = req.params.id;
        const isObjectId = mongoose.Types.ObjectId.isValid(idParam);
        const queryObj = isObjectId ? { _id: idParam } : { empId: parseInt(idParam) };

        const employee = await Employee.findOneAndDelete(queryObj);
        if (!employee) return res.status(404).json({ message: "Employee not found" });
        res.json({ message: "Employee deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
