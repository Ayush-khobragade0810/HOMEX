import Service from "../models/Service.js";
import Activity from "../models/Activity.js";
import Employee from "../models/adminEmployee.js";
import { ApiError } from "../utils/ApiError.js";

const isAdminRequest = (req) => String(req.user?.role || '').toLowerCase() === 'admin';
const isOwnEmpId = (req, empId) =>
    req.user?.empId !== undefined && req.user?.empId !== null && Number(req.user.empId) === Number(empId);
const notYours = () => ApiError.forbidden('This service is not assigned to you.', { code: 'NOT_ASSIGNED' });

// Get services for employee
export const getEmployeeServices = async (req, res, next) => {
    try {
        const { empId } = req.params;
        const { status, limit = 50 } = req.query;

        if (!isAdminRequest(req) && !isOwnEmpId(req, empId)) {
            throw ApiError.forbidden('You can only view your own services.');
        }

        let query = { empId: parseInt(empId) };

        if (status) {
            query.status = status;
        }

        const services = await Service.find(query)
            .sort({ scheduledDate: -1 })
            .limit(parseInt(limit))
            .lean();

        res.json(services);
    } catch (err) {
        next(err);
    }
};

// Update service status
export const updateServiceStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, actualHours, rating, feedback } = req.body;
        const updateData = { status };

        if (status === 'completed') {
            updateData.completedDate = new Date();
            if (actualHours) updateData.actualHours = actualHours;
            if (rating) updateData.rating = rating;
            if (feedback) updateData.feedback = feedback;
        }

        const existing = await Service.findOne({ serviceId: parseInt(id) }).select('empId status').lean();
        if (!existing) throw ApiError.notFound("Service not found");
        if (!isAdminRequest(req) && !isOwnEmpId(req, existing.empId)) throw notYours();
        if (['completed', 'cancelled'].includes(existing.status)) {
            throw ApiError.conflict(`Cannot change the status of a service that is already ${existing.status}.`, { code: 'INVALID_STATUS_TRANSITION' });
        }

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(id) },
            updateData,
            { new: true }
        );

        if (!service) {
            throw ApiError.notFound("Service not found");
        }

        // Log activity based on status change
        let activityMessage = '';
        let activityType = '';

        switch (status) {
            case 'completed':
                activityMessage = `Completed ${service.category} service for ${service.customer?.name}`;
                activityType = 'service_completed';
                
                // Update employee completed jobs count
                await Employee.findOneAndUpdate(
                    { empId: service.empId },
                    { $inc: { completedJobs: 1 } }
                );
                break;
            case 'in_progress':
                activityMessage = `Started ${service.category} service for ${service.customer?.name}`;
                activityType = 'service_scheduled';
                break;
        }

        if (activityMessage) {
            await Activity.create({
                empId: service.empId,
                type: activityType,
                message: activityMessage,
                serviceId: service.serviceId
            });
        }

        res.json(service);
    } catch (err) {
        next(err);
    }
};

// Add rating to completed service
export const addServiceRating = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { rating, feedback } = req.body;

        const existing = await Service.findOne({ serviceId: parseInt(id) }).select('status customer.email').lean();
        if (!existing) throw ApiError.notFound("Service not found");
        const customerEmail = String(existing.customer?.email || '').toLowerCase();
        const callerEmail = String(req.user?.email || '').toLowerCase();
        if (!isAdminRequest(req) && !(customerEmail && customerEmail === callerEmail)) {
            throw ApiError.forbidden('You can only rate your own services.');
        }
        if (existing.status !== 'completed') {
            throw ApiError.conflict('You can only rate a service after it is completed.', { code: 'INVALID_STATUS_TRANSITION' });
        }

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(id) },
            { rating, feedback },
            { new: true }
        );

        if (!service) {
            throw ApiError.notFound("Service not found");
        }

        // Log activity for rating
        await Activity.create({
            empId: service.empId,
            type: 'rating_received',
            message: `Received ${rating}-star rating from ${service.customer?.name || 'Customer'}`,
            serviceId: service.serviceId,
            metadata: { rating }
        });

        // Update employee average rating
        const employeeServices = await Service.find({
            empId: service.empId,
            rating: { $exists: true, $ne: null }
        });

        if (employeeServices.length) {
            const avgRating = employeeServices.reduce((sum, s) => sum + s.rating, 0) / employeeServices.length;
            await Employee.findOneAndUpdate(
                { empId: service.empId },
                { rating: Math.round(avgRating * 10) / 10 }
            );
        }

        res.json(service);
    } catch (err) {
        next(err);
    }
};