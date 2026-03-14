import { io } from "socket.io-client";
import mongoose from "mongoose";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import Booking from "../models/Booking.js";

// Setup environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const SOCKET_URL = "http://localhost:5000";
const API_URL = "http://localhost:5000/api";

const verifySocket = async () => {
    try {
        console.log("🚀 Starting verification...");

        // 1. Connect to DB to find an admin and a booking
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ DB Connected");

        const admin = await User.findOne({ role: 'admin' });
        if (!admin) throw new Error("No admin found");
        console.log(`👤 Found Admin: ${admin.email}`);

        // Generate token locally (faster than login)
        const token = jwt.sign(
            { id: admin._id, role: admin.role },
            process.env.JWT_SECRET || 'dev-secret',
            { expiresIn: "1h" }
        );
        console.log("🔑 Generated Token");

        // Find a booking to update
        const booking = await Booking.findOne();
        if (!booking) throw new Error("No booking found");
        console.log(`📅 Found Booking: ${booking.bookingId} (Current Status: ${booking.status})`);

        // 2. Connect Socket
        console.log("🔌 Connecting to Socket...");
        const socket = io(SOCKET_URL, {
            auth: { token },
            transports: ['websocket']
        });

        socket.on("connect", () => {
            console.log("✅ Socket Connected via Client");

            // Join admin room (should be automatic but let's verify connection first)
            console.log(`CLIENT ID: ${socket.id}`);
        });

        socket.on("connect_error", (err) => {
            console.error("❌ Socket Connection Error:", err.message);
        });

        // Listen for updates
        const updatePromise = new Promise((resolve, reject) => {
            let resolved = false;

            socket.on("booking_status_updated", (data) => {
                console.log("📨 RECEIVED EVENT: booking_status_updated");
                console.log("📦 Data:", data.bookingId, data.status);
                if (data.bookingId === booking.bookingId) {
                    console.log("✅ Verified: Correct Booking ID");
                    resolved = true;
                    resolve(true);
                }
            });

            socket.on("booking_updated", (data) => {
                console.log("📨 RECEIVED EVENT (Admin Room): booking_updated");
                // Allow resolution if we receive the admin event too
                if (data.bookingId === booking.bookingId || data._id === booking._id.toString()) {
                    console.log("✅ Verified: Correct Booking ID in Admin Event");
                    if (!resolved) {
                        resolved = true;
                        resolve(true);
                    }
                }
            });

            // Timeout if not received
            setTimeout(() => {
                if (!resolved) {
                    reject(new Error("Timeout waiting for socket event"));
                }
            }, 10000);
        });

        // 3. Trigger Update via API
        // Need to use fetch or axios. Node 18+ has fetch.
        const newStatus = booking.status === 'PENDING' ? 'ACCEPTED' : 'PENDING'; // Toggle
        console.log(`🔄 Triggering API update to change status to ${newStatus}...`);

        const response = await fetch(`${API_URL}/admin/bookings/${booking._id}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ status: newStatus })
        });

        const result = await response.json();
        console.log("API Response:", result.success ? "Success" : result.error);

        if (!result.success) throw new Error(result.error);

        // Wait for socket event
        await updatePromise;
        console.log("✨ VERIFICATION SUCCESSFUL!");

        // Cleanup
        mongoose.connection.close();
        socket.disconnect();
        process.exit(0);

    } catch (err) {
        console.error("❌ Verification Failed:", err);
        process.exit(1);
    }
};

verifySocket();
