import { Server } from "socket.io";
import { socketAuth } from "./middleware/socketAuth.js";

let io;

export const initSocket = (server) => {
    io = new Server(server, {
        cors: {
            origin: [
                "http://localhost:5173",
                "http://localhost:5174",
                "http://localhost:3000",
                "https://homex.net.in",
                "https://www.homex.net.in"
            ],
            methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
            credentials: true
        }
    });

    // Apply authentication middleware
    io.use(socketAuth);

    io.on("connection", (socket) => {
        console.log(`✅ Socket connected: ${socket.id} (User: ${socket.user.name || socket.user.email})`);

        // Join room based on user ID
        socket.join(socket.user._id.toString());
        console.log(`👤 Joined User Room: ${socket.user._id}`);

        // Join role-based rooms
        if (socket.user.role === 'admin') {
            socket.join('admin-room');
            console.log(`🛡️ Joined Admin Room`);
        }

        // Listen for events here if we need client->server events (e.g. location ping)
        // LOCATION UPDATES FROM EMPLOYEES
        socket.on("send_location", (data) => {
            // data: { bookingId, latitude, longitude }
            // Relay to User and Admin
            if (data.bookingId) {
                io.to(data.bookingId).emit("location_update", data); // Assuming bookingId is a room or we send to user ID
                // If we want to send to the specific customer of that booking, the client needs to send customerId or we look it up.
                // For simplicity, let's assume the frontend joins a 'booking-room' for that specific booking.
            }
        });

        // Verify user is authenticated before allowing to join
        socket.on("join_booking_room", (bookingId) => {
            // Security: In a production app, verify if users are allowed to view this booking
            // For now, we trust the token identity
            socket.join(bookingId);
            console.log(`Socket ${socket.id} joined Booking Room: ${bookingId}`);
            socket.emit("joined_room", { room: bookingId }); // Ack
        });

        socket.on("disconnect", () => {
            console.log(`❌ Socket disconnected: ${socket.id}`);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error("Socket.io not initialized!");
    }
    return io;
};

// Helper functions for Controllers to emit events easily
export const emitBookingUpdate = (bookingId, status, data = {}) => {
    if (!io) return;
    io.to(bookingId).emit("booking_status_updated", {
        bookingId,
        status,
        timestamp: new Date(),
        ...data
    });
    console.log(`📢 Emitted booking_status_updated for ${bookingId}: ${status}`);
};

export const emitLocationUpdate = (bookingId, location) => {
    if (!io) return;
    io.to(bookingId).emit("location_update", { bookingId, location });
};

export const emitNotification = (userId, notification) => {
    if (!io) return;
    io.to(userId.toString()).emit("notification", notification);
};


