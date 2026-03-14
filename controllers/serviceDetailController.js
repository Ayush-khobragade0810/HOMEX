import Service from "../models/Service.js";
import ServiceNote from "../models/ServiceNote.js";

// Get complete service details with notes
export const getServiceDetails = async (req, res) => {
    try {
        const { serviceId } = req.params;

        const service = await Service.findOne({ serviceId: parseInt(serviceId) });
        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

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
            specialRequirements: service.notes ? [service.notes] : [],
            customerPhone: service.customer?.phone || 'N/A'
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

        // Get service to verify it exists and get empId
        const service = await Service.findOne({ serviceId: parseInt(serviceId) });
        if (!service) {
            return res.status(404).json({ message: "Service not found" });
        }

        // Find the highest noteId to generate new one
        const lastNote = await ServiceNote.findOne().sort({ noteId: -1 });
        const newNoteId = lastNote ? lastNote.noteId + 1 : 5001;

        const serviceNote = new ServiceNote({
            noteId: newNoteId,
            serviceId: parseInt(serviceId),
            empId: service.empId,
            note: note.trim(),
            type,
            priority,
            createdBy: 'technician'
        });

        await serviceNote.save();

        // Also update the main service notes field
        await Service.findOneAndUpdate(
            { serviceId: parseInt(serviceId) },
            { 
                $set: { 
                    notes: note.trim(),
                    updatedAt: new Date()
                } 
            }
        );

        res.status(201).json(serviceNote);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

// Get service notes
export const getServiceNotes = async (req, res) => {
    try {
        const { serviceId } = req.params;

        const notes = await ServiceNote.find({ serviceId: parseInt(serviceId) })
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

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(serviceId) },
            filteredUpdate,
            { new: true, runValidators: true }
        );

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
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

        const service = await Service.findOneAndUpdate(
            { serviceId: parseInt(serviceId) },
            { 
                $set: { 
                    specialRequirements: requirements,
                    updatedAt: new Date()
                } 
            },
            { new: true }
        );

        if (!service) {
            return res.status(404).json({ message: "Service not found" });
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

        // Get current service to find customer
        const currentService = await Service.findOne({ serviceId: parseInt(serviceId) });
        if (!currentService) {
            return res.status(404).json({ message: "Service not found" });
        }

        const customerEmail = currentService.customer?.email;
        if (!customerEmail) {
            return res.json([]);
        }

        // Find previous services for the same customer
        const serviceHistory = await Service.find({
            'customer.email': customerEmail,
            serviceId: { $ne: parseInt(serviceId) },
            status: 'completed'
        })
        .sort({ scheduledDate: -1 })
        .limit(10)
        .select('serviceId serviceType scheduledDate status estimatedEarnings');

        res.json(serviceHistory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Upload service attachment (placeholder for future implementation)
export const uploadAttachment = async (req, res) => {
    try {
        const { serviceId } = req.params;
        // This would handle file uploads in a real implementation
        // For now, return a placeholder response
        
        res.json({ 
            message: "File upload endpoint - implement file handling logic here",
            serviceId: parseInt(serviceId)
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