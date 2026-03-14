import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import logger from '../utils/logger.js';

let ioInstance = null;
const connectedUsers = new Map(); // userId -> socket data
const userRooms = new Map(); // userId -> Set of room names
const roomUsers = new Map(); // roomName -> Set of userIds

class SocketService {
    init(io) {
        if (ioInstance) {
            logger.warn('SocketService already initialized');
            return;
        }

        ioInstance = io;

        // Socket authentication middleware
        io.use(this.authenticateSocket.bind(this));

        io.on('connection', this.handleConnection.bind(this));

        logger.info('SocketService initialized');
    }

    async authenticateSocket(socket, next) {
        try {
            const token = socket.handshake.auth.token;

            if (!token) {
                logger.warn('Socket connection attempt without token');
                return next(new Error('Authentication error: Token required'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // Assuming User model export is default
            const user = await User.findById(decoded.id).select('_id role isActive');

            if (!user) {
                logger.warn({ userId: decoded.id }, 'Socket auth failed: User not found');
                return next(new Error('Authentication error: User not found'));
            }

            if (!user.isActive) {
                logger.warn({ userId: user._id }, 'Socket auth failed: User inactive');
                return next(new Error('Authentication error: Account inactive'));
            }

            socket.userId = user._id.toString();
            socket.userRole = user.role;

            next();
        } catch (error) {
            logger.error({ error: error.message }, 'Socket authentication error');

            if (error.name === 'JsonWebTokenError') {
                return next(new Error('Authentication error: Invalid token'));
            }
            if (error.name === 'TokenExpiredError') {
                return next(new Error('Authentication error: Token expired'));
            }

            return next(new Error('Authentication error'));
        }
    }

    handleConnection(socket) {
        const userId = socket.userId;
        const socketId = socket.id;

        logger.info({ userId, socketId }, 'User connected to socket');

        // Store connection
        connectedUsers.set(userId, {
            socketId,
            userId,
            userRole: socket.userRole,
            connectedAt: new Date(),
            rooms: new Set()
        });

        // Join user's personal room
        socket.join(`user:${userId}`);
        this.joinRoom(userId, `user:${userId}`);

        // Update user's socketId in database - using model
        User.findByIdAndUpdate(userId, {
            socketId,
            lastActive: new Date()
        }).catch(err => logger.error({ userId, error: err.message }, 'Failed to update user socketId'));

        // Handle disconnection
        socket.on('disconnect', () => {
            this.handleDisconnect(userId, socketId);
        });

        // Handle joining booking room
        socket.on('join:booking', (bookingId) => {
            if (!bookingId) return;

            const roomName = `booking:${bookingId}`;
            socket.join(roomName);
            this.joinRoom(userId, roomName);

            logger.debug({ userId, bookingId, roomName }, 'User joined booking room');
        });

        // Handle leaving booking room
        socket.on('leave:booking', (bookingId) => {
            if (!bookingId) return;

            const roomName = `booking:${bookingId}`;
            socket.leave(roomName);
            this.leaveRoom(userId, roomName);

            logger.debug({ userId, bookingId, roomName }, 'User left booking room');
        });

        // Handle ping
        socket.on('ping', (data) => {
            socket.emit('pong', {
                ...data,
                timestamp: new Date().toISOString(),
                serverTime: Date.now()
            });
        });

        // Handle custom events
        socket.on('booking:update', this.handleBookingUpdate.bind(this, socket));
        socket.on('location:update', this.handleLocationUpdate.bind(this, socket));
        socket.on('message:send', this.handleMessageSend.bind(this, socket));

        // Send connection success
        socket.emit('connected', {
            success: true,
            message: 'Connected to real-time server',
            userId,
            timestamp: new Date().toISOString()
        });

        logger.info({ userId, connections: this.getConnectionCount() }, 'Socket connection established');
    }

    handleDisconnect(userId, socketId) {
        const userData = connectedUsers.get(userId);

        if (userData && userData.socketId === socketId) {
            // Leave all rooms
            if (userData.rooms) {
                userData.rooms.forEach(roomName => {
                    this.leaveRoom(userId, roomName);
                });
            }

            // Remove from connected users
            connectedUsers.delete(userId);

            // Update user's socketId in database
            User.findByIdAndUpdate(userId, {
                $unset: { socketId: '' }
            }).catch(err => logger.error({ userId, error: err.message }, 'Failed to clear user socketId'));

            logger.info({ userId, socketId }, 'User disconnected from socket');
        }
    }

    handleBookingUpdate(socket, data) {
        const { bookingId, status, notes } = data;
        const userId = socket.userId;

        if (!bookingId) {
            socket.emit('error', { message: 'Booking ID is required' });
            return;
        }

        // Emit to all users in the booking room
        this.emitToRoom(`booking:${bookingId}`, 'booking:updated', {
            bookingId,
            status,
            notes,
            updatedBy: userId,
            timestamp: new Date().toISOString()
        });

        logger.debug({ userId, bookingId, status }, 'Booking update broadcast');
    }

    handleLocationUpdate(socket, data) {
        const { bookingId, location, eta } = data;
        const userId = socket.userId;

        if (!bookingId || !location) {
            socket.emit('error', { message: 'Booking ID and location are required' });
            return;
        }

        // Emit to user who booked the service
        this.emitToUserByBooking(bookingId, 'location:updated', {
            bookingId,
            location,
            eta,
            timestamp: new Date().toISOString(),
            updatedBy: userId
        });

        logger.debug({ userId, bookingId }, 'Location update broadcast');
    }

    handleMessageSend(socket, data) {
        const { bookingId, message, type = 'text' } = data;
        const userId = socket.userId;

        if (!bookingId || !message) {
            socket.emit('error', { message: 'Booking ID and message are required' });
            return;
        }

        const messagePayload = {
            bookingId,
            message,
            type,
            sender: userId,
            timestamp: new Date().toISOString(),
            messageId: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };

        // Emit to all users in the booking room
        this.emitToRoom(`booking:${bookingId}`, 'message:received', messagePayload);

        logger.debug({ userId, bookingId, messageId: messagePayload.messageId }, 'Message sent');
    }

    // Public API methods
    emitToUser(userId, event, data) {
        if (!ioInstance) {
            logger.warn('SocketService not initialized, cannot emit to user');
            return false;
        }

        const userData = connectedUsers.get(userId);
        if (!userData) {
            logger.debug({ userId, event }, 'User not connected, cannot emit');
            return false;
        }

        ioInstance.to(userData.socketId).emit(event, data);
        logger.debug({ userId, event }, 'Emitted to user');
        return true;
    }

    emitToRoom(roomName, event, data) {
        if (!ioInstance) {
            logger.warn('SocketService not initialized, cannot emit to room');
            return false;
        }

        ioInstance.to(roomName).emit(event, data);
        logger.debug({ roomName, event }, 'Emitted to room');
        return true;
    }

    emitToUserByBooking(bookingId, event, data) {
        // This would need to lookup user from booking
        // For now, emit to booking room
        return this.emitToRoom(`booking:${bookingId}`, event, data);
    }

    joinRoom(userId, roomName) {
        const userData = connectedUsers.get(userId);
        if (userData) {
            userData.rooms.add(roomName);

            if (!roomUsers.has(roomName)) {
                roomUsers.set(roomName, new Set());
            }
            roomUsers.get(roomName).add(userId);
        }
    }

    leaveRoom(userId, roomName) {
        const userData = connectedUsers.get(userId);
        if (userData) {
            userData.rooms.delete(roomName);
        }

        const usersInRoom = roomUsers.get(roomName);
        if (usersInRoom) {
            usersInRoom.delete(userId);
            if (usersInRoom.size === 0) {
                roomUsers.delete(roomName);
            }
        }
    }

    disconnectUser(userId) {
        const userData = connectedUsers.get(userId);
        if (userData && ioInstance) {
            const socket = ioInstance.sockets.sockets.get(userData.socketId);
            if (socket) {
                socket.disconnect(true);
            }
        }
    }

    disconnectAll() {
        if (ioInstance) {
            ioInstance.disconnectSockets();
        }
        connectedUsers.clear();
        userRooms.clear();
        roomUsers.clear();
    }

    getConnectionCount() {
        return connectedUsers.size;
    }

    getConnectedUsers() {
        return Array.from(connectedUsers.values());
    }

    getUserConnections(userId) {
        return connectedUsers.get(userId);
    }

    isUserConnected(userId) {
        return connectedUsers.has(userId);
    }
}

export default new SocketService();
