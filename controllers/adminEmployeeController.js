import mongoose from "mongoose";
import Employee from "../models/adminEmployee.js";
import Booking from "../models/Booking.js";
import { cache } from "../utils/helpers.js";
import { persistAvatar } from '../utils/avatarStorage.js';
import { ApiError } from "../utils/ApiError.js";

/**
 * @desc    Search and list employees with aggregated stats
 * @route   GET /api/employees
 * @access  Private/Admin
 */
export const searchEmployees = async (req, res, next) => {
    try {

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
            return res.json(cachedResults);
        }

        const employees = await Employee.find(query).select('-avatar').lean();
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
                },
                {
                    $lookup: {
                        from: "areas",
                        localField: "latestTask.location.area",
                        foreignField: "_id",
                        as: "areaInfo"
                    }
                },
                {
                    $unwind: {
                        path: "$areaInfo",
                        preserveNullAndEmptyArrays: true
                    }
                },
                {
                    $project: {
                        _id: 1,
                        latestTask: {
                            $mergeObjects: [
                                "$latestTask",
                                {
                                    location: {
                                        area: "$areaInfo",
                                        address: "$latestTask.location.address",
                                        completeAddress: "$latestTask.location.completeAddress",
                                        pincode: "$latestTask.location.pincode",
                                        landmark: "$latestTask.location.landmark",
                                        coordinates: "$latestTask.location.coordinates"
                                    }
                                }
                            ]
                        }
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
                address: emp.address || "",
                bio: emp.bio || "",
                specialties: emp.specialties || [],
                certifications: emp.certifications || [],
                currentTask: currentTask ? {
                    bookingId: currentTask.bookingId,
                    serviceName: currentTask.serviceDetails?.title || currentTask.serviceName || "Service",
                    status: currentTask.status.toLowerCase() === 'in_progress' ? 'In Progress' : currentTask.status,
                    customerName: currentTask.contactIdInfo?.fullName || currentTask.contactInfo?.fullName || "Customer",
                    customerPhone: currentTask.contactIdInfo?.phoneNumber || currentTask.contactInfo?.phoneNumber || "N/A",
                    date: currentTask.schedule?.preferredDate,
                    time: currentTask.schedule?.timeSlot,
                    location: {
                        area: currentTask.location?.area || null,
                        address:
                            currentTask.location?.completeAddress ||
                            currentTask.location?.address ||
                            '',
                        completeAddress:
                            currentTask.location?.completeAddress ||
                            currentTask.location?.address ||
                            '',
                        pincode: currentTask.location?.pincode || '',
                        landmark: currentTask.location?.landmark || '',
                        coordinates: currentTask.location?.coordinates || null
                    }
                } : null
            };
        });

        // Cache for 60 seconds to reduce DB load
        cache.set(cacheKey, formattedEmployees, 60000);

        res.json(formattedEmployees);
    } catch (err) {
        next(err);
    }
};

/**
 * @desc    Get profile for logged in employee
 * @route   GET /api/employees/profile
 * @access  Private
 */
export const getEmployeeProfile = async (req, res, next) => {
    try {

        if (!req.user?.email) {
            throw ApiError.badRequest("Your account has no email address, so no employee profile can be loaded");
        }

        let employee = await Employee.findOne({ email: req.user.email });

        // Auto-create Employee record if it doesn't exist
        if (!employee) {
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

        // Completed work: the bookings themselves cover both the count and the
        // earnings, so fetch them once and count the legacy services alongside
        // (one round trip instead of three — the database is remote).
        const completedBookingFilter = {
            $or: [
                { 'assignedTo.technicianId': employee._id },
                { assignedTo: employee._id }
            ],
            status: { $regex: /completed/i }
        };

        const { default: Service } = await import('../models/Service.js');
        const [bookingsList, servicesList] = await Promise.all([
            Booking.find(completedBookingFilter)
                .select('serviceDetails.price payment.amount billing extraServices')
                .lean(),
            Service.find({ empId: employee.empId, status: { $regex: /completed/i } })
                .select('actualEarnings estimatedEarnings')
                .lean()
        ]);

        const completedBookings = bookingsList.length;
        const completedServices = servicesList.length;
        const totalCompletedJobs = completedBookings + completedServices;

        let dynamicEarnings = 0;
        bookingsList.forEach(b => {
            const basePrice = b.serviceDetails?.price || b.payment?.amount || 0;
            const extraServices = b.extraServices || [];
            const extrasTotal = b.billing?.extrasTotal ||
                extraServices.reduce((sum, ex) => sum + (ex.amount || 0), 0) || 0;
            const totalPrice = b.billing?.grandTotal ||
                (extrasTotal > 0 ? basePrice + extrasTotal : basePrice);
            dynamicEarnings += totalPrice;
        });

        servicesList.forEach(s => {
            dynamicEarnings += (s.actualEarnings || s.estimatedEarnings || 0);
        });

        const profile = {
            id: employee.empId,
            _id: employee._id,
            name: employee.empName,
            email: employee.email,
            phone: employee.phone,
            role: employee.role,
            earnings: dynamicEarnings || employee.earnings || 0,
            avatar: employee.avatar || 'DP',
            joinDate: employee.joinDate,
            bio: employee.bio || "",
            specialties: employee.specialties || [],
            certifications: employee.certifications || [],
            address: employee.address || "",
            rating: employee.rating || 0,
            completedJobs: totalCompletedJobs,
            statistics: {
                totalEarnings: dynamicEarnings || (employee.statistics?.totalEarnings) || 0,
                hoursWorked: employee.statistics?.hoursWorked || 0
            }
        };

        res.json(profile);
    } catch (err) {
        next(err);
    }
};

/**
 * @desc    Get top technicians for dashboard
 * @route   GET /api/employees/top-technicians
 * @access  Private/Admin
 */
export const getTopTechnicians = async (req, res, next) => {
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
        next(err);
    }
};

// Matches an email regardless of case (stored emails are not normalised).
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const emailMatcher = (email) => new RegExp(`^${escapeRegex(String(email).trim())}$`, 'i');

/** Employee routes accept the Mongo _id or the numeric empId. */
const employeeQueryFor = (idParam) => {
    if (mongoose.Types.ObjectId.isValid(idParam) && new mongoose.Types.ObjectId(idParam).toString() === idParam) {
        return { _id: idParam };
    }
    const empId = Number.parseInt(idParam, 10);
    if (!Number.isFinite(empId) || String(empId) !== String(idParam).trim()) {
        throw ApiError.badRequest("Invalid employee ID format");
    }
    return { empId };
};

/** 409 when another employee already uses this email / phone. */
const assertUniqueContact = async ({ email, phone }, excludeId) => {
    const notSelf = excludeId ? { _id: { $ne: excludeId } } : {};
    if (email) {
        const taken = await Employee.exists({ ...notSelf, email: emailMatcher(email) });
        if (taken) throw ApiError.conflict("An employee with this email already exists");
    }
    if (phone) {
        const taken = await Employee.exists({ ...notSelf, phone: String(phone).trim() });
        if (taken) throw ApiError.conflict("An employee with this phone number already exists");
    }
};

/**
 * @desc    Create new employee
 * @route   POST /api/employees
 * @access  Private/Admin
 */
export const createEmployee = async (req, res, next) => {
    try {
        // Formats are checked by validate({ body: createEmployee }) on the route.
        const { name, email, phone, role, earnings, status, countryId, stateId, cityId, areaId, address, bio, specialties, certifications } = req.body;

        await assertUniqueContact({ email, phone });

        const newEmployee = new Employee({
            empName: name,
            email,
            phone,
            role,
            earnings: earnings !== undefined ? earnings : 0,
            status: status || "Active",
            countryId,
            stateId,
            cityId,
            areaId,
            address: address || "",
            bio: bio || "",
            specialties: specialties || [],
            certifications: certifications || [],
            avatar: name ? name.split(' ').map(n => n[0]).join('').toUpperCase() : "DP"
        });

        const savedEmployee = await newEmployee.save();
        res.status(201).json(savedEmployee);
    } catch (err) {
        // Mongoose validation -> 400, duplicate key -> 409, anything else -> 500.
        next(err);
    }
};

/**
 * @desc    Update employee profile
 * @route   PUT /api/employees/:id
 * @access  Private/Admin
 */
export const updateEmployeeProfile = async (req, res, next) => {
    try {
        const {
            name, empName, email, phone, role, earnings, status,
            countryId, stateId, cityId, areaId,
            bio, specialties, certifications, address, avatar,
            settings
        } = req.body;

        const queryObj = employeeQueryFor(req.params.id);
        const current = await Employee.findOne(queryObj).select('_id email phone').lean();
        if (!current) throw ApiError.notFound("Employee not found");

        // Only check uniqueness for values that actually change, so records
        // that already share a phone can still be edited.
        const emailChanged = email && String(email).trim().toLowerCase() !== String(current.email || '').toLowerCase();
        const phoneChanged = phone && String(phone).trim() !== String(current.phone || '').trim();
        await assertUniqueContact({
            email: emailChanged ? email : undefined,
            phone: phoneChanged ? phone : undefined
        }, current._id);

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
        // Base64 avatars are written to /uploads/avatars; only the URL is stored.
        if (avatar) updateData.avatar = await persistAvatar(avatar, `emp-${req.params.id || 'x'}`);
        if (settings) updateData.settings = settings;

        const employee = await Employee.findOneAndUpdate(
            { _id: current._id },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!employee) throw ApiError.notFound("Employee not found");
        res.json(employee);
    } catch (err) {
        next(err);
    }
};

/**
 * @desc    Delete employee
 * @route   DELETE /api/employees/:id
 * @access  Private/Admin
 */
export const deleteEmployee = async (req, res, next) => {
    try {
        const employee = await Employee.findOneAndDelete(employeeQueryFor(req.params.id));
        if (!employee) throw ApiError.notFound("Employee not found");
        res.json({ message: "Employee deleted successfully" });
    } catch (err) {
        next(err);
    }
};
