
/**
 * @desc    Assign booking to employee
 * @route   POST /api/admin/bookings/:id/assign
 * @access  Private/Admin
 */
router.post("/bookings/:id/assign", authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { employeeId } = req.body;

        if (!employeeId) {
            return res.status(400).json({ success: false, error: "Employee ID is required" });
        }

        // 1. Find Booking
        let booking;
        if (mongoose.Types.ObjectId.isValid(id)) {
            booking = await Booking.findById(id);
        } else {
            booking = await Booking.findOne({ bookingId: id });
        }

        if (!booking) {
            return res.status(404).json({ success: false, error: "Booking not found" });
        }

        // 2. Find Employee
        const employee = await Employee.findById(employeeId);
        if (!employee) {
            return res.status(404).json({ success: false, error: "Employee not found" });
        }

        // 3. Update Booking
        booking.status = 'assigned';
        booking.assignedTo = employee._id;
        await booking.save();

        // 4. Create Service Record for Employee Dashboard
        // Generate a unique numeric serviceId
        const lastService = await Service.findOne().sort({ serviceId: -1 });
        const newServiceId = lastService ? lastService.serviceId + 1 : 1001;

        // Determine customer name/details
        const customerName = booking.userName || booking.contactIdInfo?.fullName || booking.contactInfo?.fullName || "Guest";
        const customerPhone = booking.userPhone || booking.contactIdInfo?.phoneNumber || booking.contactInfo?.phoneNumber || "";
        const customerAddress = booking.location?.completeAddress ||
            `${booking.location?.area}, ${booking.location?.city}` || "";
        const customerEmail = booking.userEmail || booking.contactIdInfo?.email || booking.contactInfo?.email || "";

        const newService = new Service({
            serviceId: newServiceId,
            empId: employee.empId,
            title: booking.serviceName || booking.serviceDetails?.title || "Service Assignment",
            description: booking.specialInstructions || "No special instructions",
            serviceType: booking.category || booking.serviceDetails?.category || "General",
            status: 'scheduled',
            customer: {
                name: customerName,
                address: customerAddress,
                phone: customerPhone,
                email: customerEmail
            },
            scheduledDate: booking.schedule?.preferredDate || booking.date,
            time: booking.schedule?.timeSlot || booking.time,
            estimatedEarnings: (booking.price || booking.payment?.amount || 0) * 0.8, // Assuming 80% split
            paymentStatus: booking.payment?.status || 'pending',
            notes: `Booking Ref: ${booking.bookingId}`
        });

        await newService.save();

        // 5. Create Notification
        await Notification.create({
            recipient: employee._id,
            title: "New Service Assignment",
            message: `You have been assigned a new service: ${newService.title} for ${customerName}`,
            type: "assignment",
            relatedId: newService._id,
            relatedModel: "Service"
        });

        res.json({
            success: true,
            message: "Booking assigned successfully",
            booking: booking
        });

    } catch (error) {
        console.error("Assign Booking Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});
