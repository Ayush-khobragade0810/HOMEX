import Service from "../models/Service.js";
import ServiceNote from "../models/ServiceNote.js";
import Booking from "../models/Booking.js";
import mongoose from "mongoose";
import { computeBilling, bookingTotals } from "../utils/billing.js";

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

// Get complete service details with notes
export const getServiceDetails = async (req, res) => {
    try {
        const { serviceId } = req.params;

        let service = null;
        if (!isNaN(Number(serviceId))) {
            service = await Service.findOne({ serviceId: parseInt(serviceId) });
        }

        if (service) {
            const notes = await ServiceNote.find({ serviceId: parseInt(serviceId) })
                .sort({ createdAt: -1 });

            // Format service data for frontend
            const serviceDetails = {
                ...service.toObject(),
                notes: notes.map(note => ({
                    note: note.note,
                    timestamp: note.createdAt,
                    type: note.type,
                    priority: note.priority,
                    createdBy: note.createdBy
                })),
                category: service.category || service.serviceType || 'General',
                specialRequirements: service.notes ? [service.notes] : [],
                customerPhone: service.customer?.phone || 'N/A',
                alternatePhone: service.customer?.alternatePhone || 'N/A',
                address: service.customer?.address || 'No address provided',
                landmark: service.customer?.landmark || 'N/A',
                pincode: service.customer?.pincode || 'N/A'
            };

            return res.json(serviceDetails);
        }

        // If not found in Service collection, look up in Booking collection
        const query = mongoose.Types.ObjectId.isValid(serviceId) ? { _id: serviceId } : { bookingId: serviceId };
        const booking = await Booking.findOne(query)
            .populate('userId', 'name phone address email')
            .populate('location.area')
            .lean();

        if (!booking) {
            return res.status(404).json({ message: "Service or Booking not found" });
        }

        const notes = await ServiceNote.find({ serviceId: serviceId })
            .sort({ createdAt: -1 });

        let durationHours = 1;
        if (booking.serviceDetails?.duration) {
            durationHours = booking.serviceDetails.duration > 10 ? Math.round(booking.serviceDetails.duration / 60) : booking.serviceDetails.duration;
        } else if (booking.serviceId?.duration) {
            durationHours = booking.serviceId.duration > 10 ? Math.round(booking.serviceId.duration / 60) : booking.serviceId.duration;
        }

        const serviceDetails = {
            _id: booking._id,
            id: booking.bookingId || booking._id.toString(),
            serviceId: booking.bookingId || booking._id.toString(),
            title: booking.serviceDetails?.title || 'Service',
            description: booking.serviceDetails?.description || '',
            serviceType: booking.serviceDetails?.title || 'Service',
            status: booking.status.toLowerCase(),
            notes: notes.map(note => ({
                note: note.note,
                timestamp: note.createdAt,
                type: note.type,
                priority: note.priority,
                createdBy: note.createdBy
            })),
            category: booking.serviceDetails?.category || 'General',
            specialRequirements: booking.notes ? [booking.notes] : [],
            customer: booking.contactIdInfo?.fullName || booking.userId?.name || 'Guest',
            customerPhone: booking.contactIdInfo?.phoneNumber || booking.userId?.phone || 'N/A',
            alternatePhone: booking.contactIdInfo?.alternatePhone || 'N/A',
            address: getFullAddress(booking),
            landmark: booking.location?.landmark || 'N/A',
            pincode: booking.location?.pincode || 'N/A',
            time: booking.schedule?.timeSlot || '09:00 AM',
            scheduledDate: booking.schedule?.preferredDate,
            duration: durationHours,
            // base price + extras breakdown + grand total
            ...bookingTotals(booking),
            location: booking.location || null
        };

        res.json(serviceDetails);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Add note to service
export const addServiceNote = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const { note, type = 'general', priority = 'medium' } = req.body;

        if (!note || !note.trim()) {
            return res.status(400).json({ message: "Note content is required" });
        }

        let service = null;
        let empId = 1;
        
        if (!isNaN(Number(serviceId))) {
            service = await Service.findOne({ serviceId: parseInt(serviceId) });
            if (service) empId = service.empId;
        }

        let booking = null;
        if (!service) {
            const query = mongoose.Types.ObjectId.isValid(serviceId) ? { _id: serviceId } : { bookingId: serviceId };
            booking = await Booking.findOne(query);
            if (booking) {
                empId = booking.assignedTo?.technicianId || req.user?.id || 1;
            }
        }

        if (!service && !booking) {
            return res.status(404).json({ message: "Service or Booking not found" });
        }

        // Find the highest noteId to generate new one
        const lastNote = await ServiceNote.findOne().sort({ noteId: -1 });
        const newNoteId = lastNote ? lastNote.noteId + 1 : 5001;

        const serviceNote = new ServiceNote({
            noteId: newNoteId,
            serviceId: service ? parseInt(serviceId) : serviceId,
            empId,
            note: note.trim(),
            type,
            priority,
            createdBy: 'technician'
        });

        await serviceNote.save();

        if (service) {
            await Service.findOneAndUpdate(
                { serviceId: parseInt(serviceId) },
                { 
                    $set: { 
                        notes: note.trim(),
                        updatedAt: new Date()
                    } 
                }
            );
        } else {
            await Booking.findOneAndUpdate(
                { _id: booking._id },
                {
                    $set: {
                        technicianNotes: note.trim(),
                        notes: note.trim(),
                        updatedAt: new Date()
                    }
                }
            );
        }

        res.status(201).json(serviceNote);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Get service notes
export const getServiceNotes = async (req, res) => {
    try {
        const { serviceId } = req.params;

        const queryId = !isNaN(Number(serviceId)) ? parseInt(serviceId) : serviceId;
        const notes = await ServiceNote.find({ serviceId: queryId })
            .sort({ createdAt: -1 });

        res.json(notes);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Update service information
export const updateServiceInfo = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const updateData = req.body;

        // Remove fields that shouldn't be updated directly
        const allowedFields = [
            'status', 'notes', 'priority', 'duration', 
            'estimatedEarnings', 'actualEarnings'
        ];
        
        const filteredUpdate = {};
        Object.keys(updateData).forEach(key => {
            if (allowedFields.includes(key)) {
                filteredUpdate[key] = updateData[key];
            }
        });

        let service = null;
        if (!isNaN(Number(serviceId))) {
            service = await Service.findOneAndUpdate(
                { serviceId: parseInt(serviceId) },
                filteredUpdate,
                { new: true, runValidators: true }
            );
        }

        if (!service) {
            const query = mongoose.Types.ObjectId.isValid(serviceId) ? { _id: serviceId } : { bookingId: serviceId };
            
            const bookingUpdate = {};
            if (filteredUpdate.status) {
                const statusMap = {
                    'confirmed': 'ACCEPTED',
                    'in_progress': 'IN_PROGRESS',
                    'completed': 'COMPLETED',
                    'cancelled': 'CANCELLED',
                    'scheduled': 'PENDING',
                    'en_route': 'NAVIGATING',
                    'accepted': 'ACCEPTED'
                };
                bookingUpdate.status = statusMap[filteredUpdate.status] || filteredUpdate.status.toUpperCase();
            }
            if (filteredUpdate.notes) {
                bookingUpdate.technicianNotes = filteredUpdate.notes;
                bookingUpdate.notes = filteredUpdate.notes;
            }
            if (filteredUpdate.duration) {
                bookingUpdate['serviceDetails.duration'] = filteredUpdate.duration * 60;
            }
            if (filteredUpdate.estimatedEarnings !== undefined && filteredUpdate.estimatedEarnings !== null && filteredUpdate.estimatedEarnings !== '') {
                // This edits the BASE price (unlike a collected-earnings figure,
                // which must never be written here — see scheduleController).
                const base = Number(filteredUpdate.estimatedEarnings);
                if (!Number.isFinite(base) || base < 0) {
                    return res.status(400).json({ message: 'estimatedEarnings must be a non-negative number.' });
                }
                bookingUpdate['serviceDetails.price'] = base;
            }

            // Changing the base price changes the invoice — recompute it here so
            // the stored breakdown cannot drift from serviceDetails + extras.
            const existingBooking = await Booking.findOne(query).lean();
            if (existingBooking) {
                bookingUpdate.billing = computeBilling(existingBooking, {
                    baseAmount: bookingUpdate['serviceDetails.price'] ?? existingBooking.serviceDetails?.price
                });
            }

            const booking = await Booking.findOneAndUpdate(
                query,
                { $set: bookingUpdate },
                { new: true }
            );

            if (!booking) {
                return res.status(404).json({ message: "Service or Booking not found" });
            }

            return res.json(booking);
        }

        res.json(service);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Add special requirements to service
export const addSpecialRequirements = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const { requirements } = req.body;

        if (!requirements || !Array.isArray(requirements)) {
            return res.status(400).json({ message: "Requirements must be an array" });
        }

        let service = null;
        if (!isNaN(Number(serviceId))) {
            service = await Service.findOneAndUpdate(
                { serviceId: parseInt(serviceId) },
                { 
                    $set: { 
                        specialRequirements: requirements,
                        updatedAt: new Date()
                    } 
                },
                { new: true }
            );
        }

        if (!service) {
            const query = mongoose.Types.ObjectId.isValid(serviceId) ? { _id: serviceId } : { bookingId: serviceId };
            const reqString = requirements.join(', ');
            const booking = await Booking.findOneAndUpdate(
                query,
                {
                    $set: {
                        notes: reqString,
                        updatedAt: new Date()
                    }
                },
                { new: true }
            );

            if (!booking) {
                return res.status(404).json({ message: "Service or Booking not found" });
            }

            return res.json(booking);
        }

        res.json(service);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Get service history (previous services for same customer)
export const getServiceHistory = async (req, res) => {
    try {
        const { serviceId } = req.params;

        let customerEmail = null;
        if (!isNaN(Number(serviceId))) {
            const currentService = await Service.findOne({ serviceId: parseInt(serviceId) });
            if (currentService) {
                customerEmail = currentService.customer?.email;
            }
        }

        if (!customerEmail) {
            const query = mongoose.Types.ObjectId.isValid(serviceId) ? { _id: serviceId } : { bookingId: serviceId };
            const booking = await Booking.findOne(query).populate('userId');
            if (booking) {
                customerEmail = booking.contactIdInfo?.email || booking.userId?.email;
            }
        }

        if (!customerEmail) {
            return res.json([]);
        }

        const [pastServices, userObj] = await Promise.all([
            Service.find({
                'customer.email': customerEmail,
                status: 'completed'
            })
            .sort({ scheduledDate: -1 })
            .limit(5)
            .select('serviceId serviceType scheduledDate status estimatedEarnings'),
            mongoose.model('User').findOne({ email: customerEmail })
        ]);

        const bookingQuery = { status: { $in: ['COMPLETED', 'completed'] } };
        if (userObj) {
            bookingQuery.$or = [
                { 'contactIdInfo.email': customerEmail },
                { userId: userObj._id }
            ];
        } else {
            bookingQuery['contactIdInfo.email'] = customerEmail;
        }

        const bookingsList = await Booking.find(bookingQuery).sort({ updatedAt: -1 }).limit(5);

        const history = [
            ...pastServices.map(s => ({
                id: s.serviceId,
                serviceType: s.serviceType,
                scheduledDate: s.scheduledDate,
                status: s.status,
                estimatedEarnings: s.estimatedEarnings
            })),
            ...bookingsList.map(b => ({
                id: b.bookingId || b._id.toString(),
                serviceType: b.serviceDetails?.title || 'Service',
                scheduledDate: b.schedule?.preferredDate,
                status: b.status.toLowerCase(),
                estimatedEarnings: b.serviceDetails?.price || 0
            }))
        ];

        res.json(history.slice(0, 10));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Upload service attachment (placeholder for future implementation)
export const uploadAttachment = async (req, res) => {
    try {
        const { serviceId } = req.params;
        
        res.json({ 
            message: "File upload endpoint - implement file handling logic here",
            serviceId: serviceId
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Delete service note
export const deleteServiceNote = async (req, res) => {
    try {
        const { noteId } = req.params;

        const note = await ServiceNote.findOneAndDelete({ noteId: parseInt(noteId) });

        if (!note) {
            return res.status(404).json({ message: "Note not found" });
        }

        res.json({ message: "Note deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};