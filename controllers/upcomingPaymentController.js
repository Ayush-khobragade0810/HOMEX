import UpcomingPayment from "../models/UpcomingPayment.js";
import Service from "../models/Service.js";

// Get upcoming payments for employee
export const getUpcomingPayments = async (req, res) => {
    try {
        const { empId } = req.params;
        const upcomingPayments = await UpcomingPayment.find({ 
            empId: parseInt(empId) 
        }).sort({ scheduledDate: 1 });

        res.json(upcomingPayments);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Create upcoming payment (when service is scheduled)
export const createUpcomingPayment = async (req, res) => {
    try {
        const { empId, serviceId, estimatedAmount, scheduledDate, customer, serviceType, hours } = req.body;

        // Find the highest upcomingId to generate new one
        const lastUpcoming = await UpcomingPayment.findOne().sort({ upcomingId: -1 });
        const newUpcomingId = lastUpcoming ? lastUpcoming.upcomingId + 1 : 2001;

        const upcomingPayment = new UpcomingPayment({
            upcomingId: newUpcomingId,
            empId: parseInt(empId),
            serviceId: parseInt(serviceId),
            estimatedAmount,
            scheduledDate: new Date(scheduledDate),
            customer,
            serviceType,
            hours,
            status: 'scheduled'
        });

        await upcomingPayment.save();
        res.status(201).json(upcomingPayment);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Update upcoming payment status
export const updateUpcomingPaymentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const upcomingPayment = await UpcomingPayment.findOneAndUpdate(
            { upcomingId: parseInt(id) },
            { status },
            { new: true }
        );

        if (!upcomingPayment) {
            return res.status(404).json({ message: "Upcoming payment not found" });
        }

        res.json(upcomingPayment);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Delete upcoming payment
export const deleteUpcomingPayment = async (req, res) => {
    try {
        const { id } = req.params;

        const upcomingPayment = await UpcomingPayment.findOneAndDelete({ 
            upcomingId: parseInt(id) 
        });

        if (!upcomingPayment) {
            return res.status(404).json({ message: "Upcoming payment not found" });
        }

        res.json({ message: "Upcoming payment deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};