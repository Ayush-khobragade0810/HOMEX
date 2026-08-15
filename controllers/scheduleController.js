import Booking from "../models/Booking.js";
import Service from "../models/Service.js";
import mongoose from "mongoose";
import moment from "moment";

const getFullAddress = (b) => {
    if (!b) return '';
    const loc = b.location;
    if (!loc) return b.userId?.address || '';
    const street = loc.completeAddress || loc.address || '';
    if (loc.area && typeof loc.area === 'object') {
        const areaName = loc.area.areaName || loc.area.name || '';
        const city = loc.area.city || '';
        const state = loc.area.state || '';
        const country = loc.area.country || '';
        const parts = [street, areaName, city, state, country].filter(Boolean);
        return parts.join(', ');
    }
    return street || b.userId?.address || '';
};

const getServiceFullAddress = (s) => {
    if (!s?.customer) return '';

    const customer = s.customer;

    const parts = [
        customer.completeAddress || customer.address,
        customer.areaName || customer.area?.areaName || customer.area?.name,
        customer.city || customer.area?.city,
        customer.state || customer.area?.state,
        customer.country || customer.area?.country
    ].filter(Boolean);

    return [...new Set(parts)].join(', ');
};

const getFormattedLocation = (b) => {
    if (!b || !b.location) return null;
    let areaObj = null;
    if (b.location.area) {
        if (typeof b.location.area === 'object') {
            areaObj = {
                _id: b.location.area._id,
                area: b.location.area.areaName || b.location.area.name || "",
                areaName: b.location.area.areaName || b.location.area.name || "",
                city: b.location.area.city || "",
                state: b.location.area.state || "",
                country: b.location.area.country || "",
                pincode: b.location.area.pincode || ""
            };
        }
    }
    return {
        area: areaObj || b.location.area,
        address: b.location.completeAddress || b.location.address || "",
        completeAddress: b.location.completeAddress || b.location.address || "",
        pincode: b.location.pincode || (areaObj ? areaObj.pincode : ""),
        landmark: b.location.landmark || "",
        coordinates: b.location.coordinates || null
    };
};

const getDateRangeForView = (view, dateInput, dateFilter) => {
    // agenda sub-filters mapping
    let effectiveView = view;
    if (view === 'agenda') {
        if (dateFilter === 'today') effectiveView = 'day';
        else if (dateFilter === 'week') effectiveView = 'week';
        else if (dateFilter === 'month') effectiveView = 'month';
        else return null; 
    }

    const refDate = dateInput ? moment(dateInput) : moment();
    if (!refDate.isValid()) return null;

    let start, end;

    if (effectiveView === 'day') {
        start = refDate.clone().startOf('day');
        end = refDate.clone().endOf('day');
    } else if (effectiveView === 'week') {
        start = refDate.clone().startOf('week');
        end = refDate.clone().endOf('week');
    } else if (effectiveView === 'month') {
        start = refDate.clone().startOf('month');
        end = refDate.clone().endOf('month');
    } else {
        return null;
    }

    // Apply +/- 24h buffer for timezone safety
    return {
        start: start.subtract(24, 'hours').toDate(),
        end: end.add(24, 'hours').toDate()
    };
};

const toValidDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Helper: Resolve any ID (Employee Numeric, Employee ObjectId, or User ObjectId) to User ObjectId
const resolveToUserId = async (idInput) => {
    try {
        const { default: User } = await import('../models/User.js');
        const { default: Employee } = await import('../models/adminEmployee.js');

        // Case 1: ObjectId (could be Employee._id or User._id)
        if (mongoose.Types.ObjectId.isValid(idInput)) {
            const emp = await Employee.findById(idInput);
            if (emp) {
                const user = await User.findOne({ email: emp.email });
                if (user) return user._id;
            }
            const user = await User.findById(idInput);
            if (user) return user._id;
        }

        // Case 2: Numeric ID (empId string or number)
        const numericId = parseInt(idInput);
        if (!isNaN(numericId)) {
            const emp = await Employee.findOne({ empId: numericId });
            if (emp) {
                const user = await User.findOne({ email: emp.email });
                if (user) return user._id;
            }
        }

        return idInput;
    } catch (err) {
        console.error("Error resolving user ID:", err);
        return idInput;
    }
};

// Unified Schedule Controller (Best Practice)
// Uses req.user from protect middleware
export const getSchedules = async (req, res) => {
    try {
        // Prevent caching
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');

        const { view, date, includeCompleted, dateFilter } = req.query;
        
        // req.user is populated by protect middleware
        // id is the Employee ObjectId, empId is the numeric ID (e.g. 101)
        const employeeId = req.user.id; 
        const numericEmpId = req.user.empId;

        // --- QUERY 1: BOOKINGS (New System) ---
        const bookingStatuses = [
            'pending', 'PENDING', 'confirmed', 'CONFIRMED', 'assigned', 'ASSIGNED',
            'scheduled', 'SCHEDULED', 'accepted', 'ACCEPTED', 'in_progress', 'IN_PROGRESS',
            'navigating', 'NAVIGATING', 'started', 'STARTED', 'completed', 'COMPLETED',
            'cancelled', 'CANCELLED'
        ];

        const filteredBookingStatuses = String(includeCompleted) === 'false'
            ? bookingStatuses.filter(s => !['completed', 'COMPLETED'].includes(s.toUpperCase()))
            : bookingStatuses;

        const bookingQuery = {
            $and: [
                { $or: [
                    { 'assignedTo.technicianId': employeeId },
                    { assignedTo: employeeId }
                ]},
                { status: { $in: filteredBookingStatuses } }
            ]
        };

        // --- QUERY 2: SERVICES (Legacy System) ---
        const baseServiceStatuses = ['assigned', 'scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled'];
        const serviceStatuses = String(includeCompleted) === 'false'
            ? baseServiceStatuses.filter(s => s !== 'completed')
            : baseServiceStatuses;
        
        const allServiceStatuses = [...serviceStatuses, ...serviceStatuses.map(s => s.toUpperCase())];

        const serviceQuery = {
            empId: numericEmpId,
            status: { $in: allServiceStatuses }
        };

        // --- DATE RANGE ---
        const period = getDateRangeForView(view, date, dateFilter);
        if (period) {
            if (String(includeCompleted) === 'true') {
                bookingQuery.$and.push({
                    $or: [
                        { 'schedule.preferredDate': { $gte: period.start, $lte: period.end } },
                        { 'completedAt': { $gte: period.start, $lte: period.end } }
                    ]
                });
            } else {
                bookingQuery['schedule.preferredDate'] = { $gte: period.start, $lte: period.end };
            }
            
            // Apply period to Legacy Service Query too! (Root cause of slowness)
            serviceQuery.scheduledDate = { $gte: period.start, $lte: period.end };
        }

        // --- EXECUTE ---
        const [bookings, services] = await Promise.all([
            Booking.find(bookingQuery)
                .populate('userId', 'name phone address location')
                .populate('location.area')
                .lean(),
            numericEmpId ? Service.find(serviceQuery).lean() : Promise.resolve([])
        ]);

        // --- MAP & MERGE ---
        let mappedBookings = bookings.map(booking => {
            // Base price from serviceDetails
            const basePrice = booking.serviceDetails?.price || booking.payment?.amount || 0;

            // Extra services added during the job
            const extraServices = booking.extraServices || [];
            const extrasTotal = booking.billing?.extrasTotal ||
                extraServices.reduce((sum, ex) => sum + (ex.amount || 0), 0) || 0;

            // Final total: use billing.grandTotal if available, otherwise base + extras
            const totalPrice = booking.billing?.grandTotal ||
                (extrasTotal > 0 ? basePrice + extrasTotal : basePrice);

            return {
                _id: booking._id,
                serviceId: booking.bookingId,
                bookingId: booking.bookingId,
                status: booking.status,
                scheduledDate: booking.status?.toUpperCase() === 'COMPLETED'
                    ? (booking.completedAt || booking.schedule?.preferredDate || booking.createdAt)
                    : (booking.schedule?.preferredDate || booking.completedAt || booking.createdAt),
                time: booking.schedule?.timeSlot || booking.time || '09:00 AM',
                serviceName: booking.serviceDetails?.title || 'Service',
                serviceType: booking.serviceDetails?.category || 'General',
                duration: booking.serviceDetails?.duration || 60,
                // Always send both base and updated total
                estimatedEarnings: basePrice,
                totalPrice,
                extrasTotal,
                hasExtras: extraServices.length > 0,
                extraServices: extraServices.map(ex => ({
                    name: ex.name,
                    quantity: ex.quantity,
                    unitPrice: ex.unitPrice,
                    amount: ex.amount
                })),
                billing: booking.billing || null,
                customer: {
                    name: booking.userId?.name || booking.contactIdInfo?.fullName || 'Customer',
                    phone: booking.userId?.phone || booking.contactIdInfo?.phoneNumber,
                    address: getFullAddress(booking)
                },
                notes: booking.notes,
                source: 'booking',
                location: getFormattedLocation(booking)
            };
        });

        let mappedServices = services.map(s => {
            const effectiveDate = toValidDate(s.scheduledDate) ||
                toValidDate(s.date) ||
                toValidDate(s.completedDate) ||
                toValidDate(s.createdAt);

            return {
                _id: s._id,
                serviceId: s.serviceId,
                bookingId: s.serviceId,
                status: s.status?.toUpperCase(),
                scheduledDate: effectiveDate,
                time: s.time || '09:00 AM',
                serviceName: s.title || s.serviceType || 'Service',
                serviceType: s.serviceType || 'General',
                duration: s.duration || 1,
                estimatedEarnings: s.estimatedEarnings || 0,
                customer: {
                    name: s.customer?.name || 'Customer',
                    phone: s.customer?.phone,
                    address: getServiceFullAddress(s) || 'No address'
                },
                notes: s.notes,
                source: 'service',
                location: s.customer ? {
                    area: s.customer.area
                        ? {
                            _id: s.customer.area?._id || s.customer.area,
                            area: s.customer.areaName || s.customer.area?.areaName || s.customer.area?.name || '',
                            areaName: s.customer.areaName || s.customer.area?.areaName || s.customer.area?.name || '',
                            city: s.customer.city || s.customer.area?.city || '',
                            state: s.customer.state || s.customer.area?.state || '',
                            country: s.customer.country || s.customer.area?.country || '',
                            pincode: s.customer.pincode || s.customer.area?.pincode || ''
                        }
                        : null,
                    address: s.customer.completeAddress || s.customer.address || '',
                    completeAddress: s.customer.completeAddress || s.customer.address || '',
                    pincode: s.customer.pincode || '',
                    landmark: s.customer.landmark || '',
                    coordinates: s.customer.coordinates || null
                } : null
            };
        });

        // Pruning filtered results after mapping (consistent with timezone buffer strategy)
        if (period) {
            const exactRef = date ? moment(date) : moment();
            let ev = view === 'agenda' ? (dateFilter === 'all' ? null : dateFilter) : view;

            const pruneByRange = (items) => {
                if (!ev) return items;
                const start = exactRef.clone().startOf(ev);
                const end = exactRef.clone().endOf(ev);
                return items.filter(item => {
                    const d = toValidDate(item.scheduledDate);
                    return d ? moment(d).isBetween(start, end, null, '[]') : false;
                });
            };

            mappedBookings = pruneByRange(mappedBookings);
            mappedServices = pruneByRange(mappedServices);
        }

        const combined = [...mappedBookings, ...mappedServices];
        combined.sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

        // --- STATS ---
        const stats = {
            total: combined.length,
            assigned: 0, accepted: 0, in_progress: 0, completed: 0, cancelled: 0
        };

        combined.forEach(item => {
            const s = item.status?.toUpperCase();
            if (['ASSIGNED', 'PENDING', 'SCHEDULED'].includes(s)) stats.assigned++;
            if (['ACCEPTED', 'CONFIRMED'].includes(s)) stats.accepted++;
            if (['IN_PROGRESS', 'STARTED', 'NAVIGATING'].includes(s)) stats.in_progress++;
            if (['COMPLETED'].includes(s)) stats.completed++;
            if (['CANCELLED'].includes(s)) stats.cancelled++;
        });

        combined.forEach(item => {
        });

        res.status(200).json({
            success: true,
            services: combined,
            stats: stats
        });

    } catch (err) {
        console.error('Schedule Error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch schedule: ' + err.message });
    }
};

// Legacy Compatibility Wrapper 
export const getEmployeeSchedule = async (req, res) => {
    return getSchedules(req, res);
};

// Get schedule statistics (Best Practice)
export const getScheduleStats = async (req, res) => {
    try {
        const employeeObjectId = req.user?.id || req.params.empId;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const stats = await Booking.aggregate([
            {
                $match: {
                    'assignedTo.technicianId': new mongoose.Types.ObjectId(employeeObjectId),
                    'schedule.preferredDate': { $gte: today }
                }
            },
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    totalEarnings: { $sum: "$serviceDetails.price" }
                }
            }
        ]);

        res.json({
            today: stats.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
            totalUpcoming: stats.reduce((sum, curr) => sum + curr.count, 0),
            totalEarnings: stats.reduce((sum, curr) => sum + (curr.totalEarnings || 0), 0)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Update service status
export const updateServiceStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes, actualEarnings } = req.body;
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };

        const updateData = {
            status: status?.toUpperCase(),
            updatedAt: new Date()
        };
        if (notes) updateData.notes = notes;
        if (actualEarnings) {
            updateData['payment.amount'] = actualEarnings;
            updateData['serviceDetails.price'] = actualEarnings;
        }
        if (status?.toUpperCase() === 'COMPLETED') {
            updateData.completedAt = new Date();
            updateData['payment.status'] = 'paid';
        }

        let result = await Booking.findOneAndUpdate(query, updateData, { new: true });
        if (!result) {
            const serviceQuery = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { serviceId: id };
            const serviceUpdate = { ...updateData };
            if (serviceUpdate.status) serviceUpdate.status = serviceUpdate.status.toLowerCase();
            result = await Service.findOneAndUpdate(serviceQuery, serviceUpdate, { new: true });
        }

        if (!result) return res.status(404).json({ message: "Service/Booking not found" });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Start service
export const startService = async (req, res) => {
    try {
        const { id } = req.params;
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };
        let result = await Booking.findOneAndUpdate(query, { status: 'IN_PROGRESS', startedAt: new Date(), updatedAt: new Date() }, { new: true });
        if (!result) result = await Service.findOneAndUpdate(mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { serviceId: id }, { status: 'in_progress', updatedAt: new Date() }, { new: true });
        if (!result) return res.status(404).json({ message: "Service not found" });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Complete service
export const completeService = async (req, res) => {
    try {
        const { id } = req.params;
        const { actualEarnings, notes } = req.body;
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };
        let result = await Booking.findOneAndUpdate(query, { status: 'COMPLETED', completedAt: new Date(), 'payment.amount': actualEarnings, 'payment.status': 'paid', technicianNotes: notes, updatedAt: new Date() }, { new: true });
        if (!result) result = await Service.findOneAndUpdate(mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { serviceId: id }, { status: 'completed', completedDate: new Date(), actualEarnings, paymentStatus: 'paid', notes }, { new: true });
        if (!result) return res.status(404).json({ message: "Service not found" });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Reschedule service
export const rescheduleService = async (req, res) => {
    try {
        const { id } = req.params;
        const { scheduledDate, time } = req.body;
        const query = mongoose.Types.ObjectId.isValid(id) ? { _id: id } : { bookingId: id };
        const result = await Booking.findOneAndUpdate(query, { 'schedule.preferredDate': new Date(scheduledDate), 'schedule.type': time, status: 'PENDING', updatedAt: new Date(), $inc: { 'schedule.rescheduledCount': 1 } }, { new: true });
        if (!result) return res.status(404).json({ message: "Service not found" });
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Today's schedule
export const getTodaySchedule = async (req, res) => {
    req.query.view = 'day';
    req.query.date = new Date().toISOString();
    return getSchedules(req, res);
};

// Upcoming services
export const getUpcomingServices = async (req, res) => {
    req.query.view = 'week';
    return getSchedules(req, res);
};

// Dedicated APIs
export const getScheduleByDay = async (req, res) => { req.query.view = 'day'; return getSchedules(req, res); };
export const getScheduleByWeek = async (req, res) => { req.query.view = 'week'; return getSchedules(req, res); };
export const getScheduleByMonth = async (req, res) => { req.query.view = 'month'; return getSchedules(req, res); };
