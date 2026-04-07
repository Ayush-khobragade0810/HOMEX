import Service from "../models/Service.js";
import Activity from "../models/Activity.js";
import Employee from "../models/adminEmployee.js";

// Get services for employee
export const getEmployeeServices = async (req, res) => {
    try {
        const { empId } = req.params;
        const { status, limit = 50 } = req.query;
        
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
        res.status(500).json({ error: err.message });
    }
};

// Update service status
export const updateServiceStatus = async (req, res) => {
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

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(id) },
            updateData,
            { new: true }
        );

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        // Log activity based on status change
        let activityMessage = '';
        let activityType = '';

        switch (status) {
            case 'completed':
                activityMessage = `Completed ${service.category} service for ${service.customer.name}`;
                activityType = 'service_completed';
                
                // Update employee completed jobs count
                await Employee.findOneAndUpdate(
                    { empId: service.empId },
                    { $inc: { completedJobs: 1 } }
                );
                break;
            case 'in-progress':
                activityMessage = `Started ${service.category} service for ${service.customer.name}`;
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
        res.status(400).json({ error: err.message });
    }
};

// Add rating to completed service
export const addServiceRating = async (req, res) => {
    try {
        const { id } = req.params;
        const { rating, feedback } = req.body;

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(id) },
            { rating, feedback },
            { new: true }
        );

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        // Log activity for rating
        await Activity.create({
            empId: service.empId,
            type: 'rating_received',
            message: `Received ${rating}-star rating from ${service.customer.name}`,
            serviceId: service.serviceId,
            metadata: { rating }
        });

        // Update employee average rating
        const employeeServices = await Service.find({
            empId: service.empId,
            rating: { $exists: true, $ne: null }
        });

        const avgRating = employeeServices.reduce((sum, s) => sum + s.rating, 0) / employeeServices.length;
        
        await Employee.findOneAndUpdate(
            { empId: service.empId },
            { rating: Math.round(avgRating * 10) / 10 }
        );

        res.json(service);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};