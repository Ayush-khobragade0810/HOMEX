import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Employee from "../models/adminEmployee.js";

// Verify token for Socket.io connection
export const socketAuth = async (socket, next) => {
    try {
        const token = socket.handshake.auth.token || socket.handshake.query.token;

        if (!token) {
            return next(new Error("Authentication error: No token provided"));
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');

        // Attach user to socket
        // Flexible: check both User and Employee models
        let user = await User.findById(decoded.id).select("-password");

        if (!user) {
            // Try finding an employee
            user = await Employee.findById(decoded.id);
            if (user) {
                socket.user = { ...user.toObject(), type: 'employee' };
            }
        } else {
            socket.user = { ...user.toObject(), type: 'customer' }; // or admin
        }

        if (!socket.user) {
            return next(new Error("Authentication error: User not found"));
        }

        next();
    } catch (err) {
        console.error("Socket Auth Error:", err.message);
        next(new Error("Authentication error: Invalid token"));
    }
};
