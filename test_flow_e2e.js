import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/homex';

async function verifyFlow() {
    try {
        await mongoose.connect(mongoURI);
        console.log('--- STEP 0: CONNECTED TO DB ---');

        const Area = (await import('./models/Area.js')).default;
        const Booking = (await import('./models/Booking.js')).default;
        const Service = (await import('./models/Service.js')).default;
        const AdminEmployee = (await import('./models/adminEmployee.js')).default;

        // 1. Find or create test Area
        let testArea = await Area.findOne({ areaName: 'Dharampeth' });
        if (!testArea) {
            testArea = await Area.create({
                areaName: 'Dharampeth',
                city: 'Nagpur',
                state: 'Maharashtra',
                country: 'India',
                pincode: '440010'
            });
        }
        console.log('1. Area Document:', {
            _id: testArea._id,
            areaName: testArea.areaName,
            city: testArea.city,
            state: testArea.state,
            country: testArea.country
        });

        // 2. Create test Booking
        const testBookingId = `BK-TEST-${Date.now()}`;
        const booking = await Booking.create({
            bookingId: testBookingId,
            serviceName: 'Deep Home Cleaning',
            serviceDetails: { title: 'Deep Home Cleaning', category: 'Cleaning', price: 1500, duration: 120 },
            location: {
                area: testArea._id,
                address: 'Near Bus Stand',
                completeAddress: 'Near Bus Stand',
                pincode: '440010'
            },
            status: 'pending',
            payment: { method: 'cash', amount: 1500, status: 'pending' },
            schedule: { preferredDate: new Date(), timeSlot: '10:00 AM' }
        });

        console.log('\n--- STEP 1: BOOKING LOCATION SAVED ---');
        console.log(JSON.stringify({
            bookingId: booking.bookingId,
            location: booking.location
        }, null, 2));

        // 3. Simulate Assignment & Service Creation
        const populatedBooking = await Booking.findById(booking._id)
            .populate('location.area')
            .lean();

        console.log('\n--- STEP 2: BOOKING LOCATION BEFORE SERVICE ---');
        console.log(JSON.stringify({
            bookingId: booking.bookingId,
            location: populatedBooking.location
        }, null, 2));

        const areaDoc = populatedBooking.location?.area;
        const customerAddress = populatedBooking.location?.completeAddress || populatedBooking.location?.address || '';

        const customerLocation = {
            name: 'Test Customer',
            address: customerAddress,
            completeAddress: customerAddress,
            phone: '9876543210',
            email: 'customer@example.com',
            area: areaDoc?._id || null,
            areaName: areaDoc?.areaName || areaDoc?.name || '',
            city: areaDoc?.city || '',
            state: areaDoc?.state || '',
            country: areaDoc?.country || '',
            pincode: populatedBooking.location?.pincode || areaDoc?.pincode || '',
            landmark: populatedBooking.location?.landmark || '',
            coordinates: populatedBooking.location?.coordinates || null
        };

        const lastService = await Service.findOne().sort({ serviceId: -1 });
        const newServiceId = lastService ? (lastService.serviceId + 1) : 9001;

        const newService = new Service({
            serviceId: newServiceId,
            empId: 101,
            title: booking.serviceName,
            description: 'Test Service Assignment',
            serviceType: 'Cleaning',
            status: 'scheduled',
            customer: customerLocation,
            scheduledDate: new Date(),
            time: '10:00 AM',
            estimatedEarnings: 1200,
            paymentStatus: 'pending',
            notes: `Booking Ref: ${booking.bookingId}`
        });

        await newService.save();

        console.log('\n--- STEP 3: SERVICE LOCATION SAVED ---');
        console.log(JSON.stringify({
            serviceId: newService.serviceId,
            customer: newService.customer
        }, null, 2));

        // 4. Verify Schedule Mapping
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

        const s = await Service.findById(newService._id).lean();
        const mappedService = {
            _id: s._id,
            serviceId: s.serviceId,
            bookingId: s.serviceId,
            status: s.status?.toUpperCase(),
            scheduledDate: s.scheduledDate,
            time: s.time,
            serviceName: s.title,
            customer: {
                name: s.customer?.name || 'Customer',
                phone: s.customer?.phone,
                address: getServiceFullAddress(s) || 'No address'
            },
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

        console.log('\n--- STEP 4: EMPLOYEE LOCATION RESPONSE ---');
        console.log(JSON.stringify({
            source: mappedService.source,
            location: mappedService.location,
            customerAddress: mappedService.customer.address
        }, null, 2));

        // Cleanup test entries
        await Booking.deleteOne({ _id: booking._id });
        await Service.deleteOne({ _id: newService._id });
        console.log('\n✅ Cleaned up test records');

        await mongoose.disconnect();
    } catch (e) {
        console.error('Error during verification:', e);
    }
}

verifyFlow();
