import Service from "../models/Service.js";
import ServiceNote from "../models/ServiceNote.js";
import Booking from "../models/Booking.js";
import mongoose from "mongoose";
import { computeBilling, bookingTotals } from "../utils/billing.js";
import { chargeForStatusChange, employeeCancellationFields } from "../services/serviceFeeService.js";
import { ApiError, sendError } from "../utils/ApiError.js";

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

const isAdminRequest = (req) => String(req.user?.role || '').toLowerCase() === 'admin';
const isEmployeeRequest = (req) => req.user?.empId !== undefined && req.user?.empId !== null;

/**
 * Only the employee a job belongs to (or an admin) may change it. Legacy
 * Service records carry a numeric empId; bookings carry assignedTo.technicianId.
 */
const assertCanModifyJob = (req, { service, booking }) => {
    if (isAdminRequest(req)) return;
    const notYours = () => ApiError.forbidden('This service is not assigned to you.', { code: 'NOT_ASSIGNED' });
    if (!isEmployeeRequest(req)) throw notYours();
    if (service && Number(service.empId) !== Number(req.user.empId)) throw notYours();
    if (booking) {
        const techId = booking.assignedTo?.technicianId?._id || booking.assignedTo?.technicianId;
        if (!techId || String(techId) !== String(req.user.id)) throw notYours();
    }
};

const ENDED_STATUSES = ['completed', 'cancelled', 'canceled', 'rejected'];

// Get complete service details with notes
export const getServiceDetails = async (req, res, next) => {
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
            throw ApiError.notFound("Service or booking not found");
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
        next(err);
    }
};

// Add note to service
export const addServiceNote = async (req, res, next) => {
    try {
        const { serviceId } = req.params;
        const { note, type = 'general', priority = 'medium' } = req.body;

        if (!note || !note.trim()) {
            throw ApiError.badRequest("Note content is required");
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
            throw ApiError.notFound("Service or booking not found");
        }
        assertCanModifyJob(req, { service, booking });

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
        next(err);
    }
};

// Get service notes
export const getServiceNotes = async (req, res, next) => {
    try {
        const { serviceId } = req.params;

        const queryId = !isNaN(Number(serviceId)) ? parseInt(serviceId) : serviceId;
        const notes = await ServiceNote.find({ serviceId: queryId })
            .sort({ createdAt: -1 });

        res.json(notes);
    } catch (err) {
        next(err);
    }
};

/** A legacy Service (numeric id) or else a Booking (ObjectId / bookingId), or 404. */
const findJob = async (serviceId) => {
    let service = null;
    if (!isNaN(Number(serviceId))) {
        service = await Service.findOne({ serviceId: parseInt(serviceId) }).lean();
    }
    if (service) return { service, booking: null };

    const query = mongoose.Types.ObjectId.isValid(serviceId) ? { _id: serviceId } : { bookingId: serviceId };
    const booking = await Booking.findOne(query).lean();
    if (!booking) throw ApiError.notFound("Service or booking not found");
    return { service: null, booking };
};

// Update service information
export const updateServiceInfo = async (req, res, next) => {
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

        const { service: legacy, booking: existingBooking } = await findJob(serviceId);
        assertCanModifyJob(req, { service: legacy, booking: existingBooking });

        if (filteredUpdate.status) {
            const current = String((legacy || existingBooking).status || '').toLowerCase();
            if (ENDED_STATUSES.includes(current)) {
                throw ApiError.conflict(`Cannot change the status of a service that is already ${current}.`, { code: 'INVALID_STATUS_TRANSITION' });
            }

            // Moving a job forward takes the employee's service fee, same as the
            // accept endpoints (this route must not be a way around it).
            const nextStatus = String(filteredUpdate.status).toLowerCase() === 'confirmed' ? 'ACCEPTED' : filteredUpdate.status;
            const fee = await chargeForStatusChange(req, serviceId, nextStatus);
            if (!fee.ok) {
                const { message, success, ...extra } = fee.body || {}; // eslint-disable-line no-unused-vars
                return sendError(res, fee.status, message, extra);
            }
        }

        if (legacy) {
            const service = await Service.findOneAndUpdate(
                { serviceId: legacy.serviceId },
                filteredUpdate,
                { new: true, runValidators: true }
            );
            if (!service) throw ApiError.notFound("Service or booking not found");
            return res.json(service);
        }

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
            const requested = String(filteredUpdate.status).trim();
            bookingUpdate.status = statusMap[requested.toLowerCase()] || requested.toUpperCase();
            Object.assign(bookingUpdate, employeeCancellationFields(req, bookingUpdate.status));
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
                throw ApiError.badRequest("Service price must be a non-negative number");
            }
            bookingUpdate['serviceDetails.price'] = base;
        }

        // Changing the base price changes the invoice — recompute it here so
        // the stored breakdown cannot drift from serviceDetails + extras.
        bookingUpdate.billing = computeBilling(existingBooking, {
            baseAmount: bookingUpdate['serviceDetails.price'] ?? existingBooking.serviceDetails?.price
        });

        const booking = await Booking.findOneAndUpdate(
            { _id: existingBooking._id },
            { $set: bookingUpdate },
            { new: true }
        );

        if (!booking) {
            throw ApiError.notFound("Service or booking not found");
        }

        res.json(booking);
    } catch (err) {
        next(err);
    }
};

// Add special requirements to service
export const addSpecialRequirements = async (req, res, next) => {
    try {
        const { serviceId } = req.params;
        const { requirements } = req.body;

        if (!requirements || !Array.isArray(requirements)) {
            throw ApiError.badRequest("Requirements must be a list");
        }

        const { service: legacy, booking: existing } = await findJob(serviceId);
        assertCanModifyJob(req, { service: legacy, booking: existing });

        if (legacy) {
            const service = await Service.findOneAndUpdate(
                { serviceId: legacy.serviceId },
                {
                    $set: {
                        specialRequirements: requirements,
                        updatedAt: new Date()
                    }
                },
                { new: true }
            );
            if (!service) throw ApiError.notFound("Service or booking not found");
            return res.json(service);
        }

        const booking = await Booking.findOneAndUpdate(
            { _id: existing._id },
            {
                $set: {
                    notes: requirements.join(', '),
                    updatedAt: new Date()
                }
            },
            { new: true }
        );

        if (!booking) {
            throw ApiError.notFound("Service or booking not found");
        }

        res.json(booking);
    } catch (err) {
        next(err);
    }
};

// Get service history (previous services for same customer)
export const getServiceHistory = async (req, res, next) => {
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
        next(err);
    }
};

// Upload service attachment (placeholder for future implementation)
export const uploadAttachment = async (req, res) => {
    const message = 'File attachments are not supported yet';
    res.status(501).json({ success: false, message, error: message, serviceId: req.params.serviceId });
};

// Delete service note
export const deleteServiceNote = async (req, res, next) => {
    try {
        const { noteId } = req.params;

        const note = await ServiceNote.findOne({ noteId: parseInt(noteId) }).lean();
        if (!note) {
            throw ApiError.notFound("Note not found");
        }

        // Notes store the author's numeric empId (legacy services) or employee _id (bookings).
        const ownNote = isEmployeeRequest(req) &&
            (String(note.empId) === String(req.user.empId) || String(note.empId) === String(req.user.id));
        if (!isAdminRequest(req) && !ownNote) {
            throw ApiError.forbidden('You can only delete your own notes.');
        }

        await ServiceNote.deleteOne({ _id: note._id });

        res.json({ message: "Note deleted successfully" });
    } catch (err) {
        next(err);
    }
};
