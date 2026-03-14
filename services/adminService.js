// services/adminService.js
import axios from 'axios';

// Admin token configuration
const ADMIN_TOKEN = process.env.REACT_APP_ADMIN_TOKEN || 'admin-secret-token-123';
const API_BASE_URL = process.env.REACT_APP_API_URL || '';

// Create axios instance with default config
const adminApi = axios.create({
    baseURL: `${API_BASE_URL}/api/admin`,
    headers: {
        'admin-token': ADMIN_TOKEN,
        'Content-Type': 'application/json'
    },
    timeout: 30000, // 30 seconds timeout
});

// Request interceptor - add auth token to every request
adminApi.interceptors.request.use(
    (config) => {
        // Add timestamp for debugging
        config.headers['X-Request-Timestamp'] = Date.now();

        // Log request in development
        if (process.env.NODE_ENV === 'development') {
            console.log(`📤 Admin API Request: ${config.method?.toUpperCase()} ${config.url}`);
        }

        return config;
    },
    (error) => {
        console.error('❌ Admin API Request Error:', error);
        return Promise.reject(error);
    }
);

// Response interceptor - handle errors globally
adminApi.interceptors.response.use(
    (response) => {
        // Log successful response in development
        if (process.env.NODE_ENV === 'development') {
            console.log(`📥 Admin API Response: ${response.status} ${response.config.url}`);
        }
        return response;
    },
    (error) => {
        // Handle errors globally
        const { response } = error;

        if (process.env.NODE_ENV === 'development') {
            console.error('❌ Admin API Error:', {
                status: response?.status,
                url: error.config?.url,
                method: error.config?.method,
                data: response?.data
            });
        }

        // Handle specific error statuses
        if (response) {
            switch (response.status) {
                case 401:
                    console.error('Admin authentication failed');
                    // Redirect to admin login or show notification
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('admin-auth-error', {
                            detail: { message: 'Session expired. Please login again.' }
                        }));
                    }
                    break;

                case 403:
                    console.error('Admin access forbidden');
                    break;

                case 404:
                    console.error('Admin resource not found');
                    break;

                case 500:
                    console.error('Admin server error');
                    break;

                default:
                    console.error(`Admin API error: ${response.status}`);
            }
        } else if (error.request) {
            // The request was made but no response was received
            console.error('No response received from admin server');
        } else {
            // Something happened in setting up the request
            console.error('Error setting up admin request:', error.message);
        }

        return Promise.reject(error);
    }
);

// Admin Service Functions
export const adminService = {
    // ==================== STATISTICS ====================
    getStats: async () => {
        try {
            const response = await adminApi.get('/stats');
            return {
                success: true,
                data: response.data,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to load statistics',
                status: error.response?.status
            };
        }
    },

    // ==================== BOOKINGS ====================
    getBookings: async (params = {}) => {
        try {
            const response = await adminApi.get('/bookings', { params });
            return {
                success: true,
                data: response.data,
                pagination: {
                    page: response.data.page || 1,
                    limit: response.data.limit || 10,
                    total: response.data.total || response.data.bookings?.length || 0,
                    totalPages: response.data.totalPages || 1
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to load bookings',
                status: error.response?.status
            };
        }
    },

    getBookingById: async (id) => {
        try {
            const response = await adminApi.get(`/bookings/${id}`);
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to load booking details',
                status: error.response?.status,
                bookingId: id
            };
        }
    },

    updateBookingStatus: async (id, status, notes = '') => {
        try {
            const response = await adminApi.patch(`/bookings/${id}/status`, { status, notes });
            return {
                success: true,
                data: response.data,
                message: 'Booking status updated successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to update booking status',
                status: error.response?.status,
                bookingId: id
            };
        }
    },

    updateBooking: async (id, data) => {
        try {
            const response = await adminApi.put(`/bookings/${id}`, data);
            return {
                success: true,
                data: response.data,
                message: 'Booking updated successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to update booking',
                status: error.response?.status,
                bookingId: id
            };
        }
    },

    deleteBooking: async (id) => {
        try {
            const response = await adminApi.delete(`/bookings/${id}`);
            return {
                success: true,
                data: response.data,
                message: 'Booking deleted successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to delete booking',
                status: error.response?.status,
                bookingId: id
            };
        }
    },

    // ==================== USERS ====================
    getUsers: async (params = {}) => {
        try {
            const response = await adminApi.get('/users', { params });
            return {
                success: true,
                data: response.data,
                pagination: {
                    page: response.data.page || 1,
                    limit: response.data.limit || 20,
                    total: response.data.total || response.data.users?.length || 0,
                    totalPages: response.data.totalPages || 1
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to load users',
                status: error.response?.status
            };
        }
    },

    getUserById: async (id) => {
        try {
            const response = await adminApi.get(`/users/${id}`);
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to load user details',
                status: error.response?.status,
                userId: id
            };
        }
    },

    updateUser: async (id, data) => {
        try {
            const response = await adminApi.put(`/users/${id}`, data);
            return {
                success: true,
                data: response.data,
                message: 'User updated successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to update user',
                status: error.response?.status,
                userId: id
            };
        }
    },

    // ==================== SERVICES ====================
    getServices: async (params = {}) => {
        try {
            const response = await adminApi.get('/services', { params });
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to load services',
                status: error.response?.status
            };
        }
    },

    // ==================== ANALYTICS ====================
    getAnalytics: async (period = 'monthly') => {
        try {
            const response = await adminApi.get('/analytics', { params: { period } });
            return {
                success: true,
                data: response.data
            };
        } catch (error) {
            return {
                success: false,
                error: error.response?.data?.error || 'Failed to load analytics',
                status: error.response?.status
            };
        }
    },

    // ==================== UTILITIES ====================
    refreshToken: async () => {
        try {
            // This would typically call a refresh token endpoint
            const response = await adminApi.post('/refresh-token');
            return {
                success: true,
                token: response.data.token
            };
        } catch (error) {
            return {
                success: false,
                error: 'Failed to refresh token'
            };
        }
    },

    // Test connection to admin API
    testConnection: async () => {
        try {
            const response = await adminApi.get('/health');
            return {
                success: true,
                data: response.data,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: 'Cannot connect to admin API',
                status: error.response?.status
            };
        }
    },

    // Clear cache (if implemented in backend)
    clearCache: async () => {
        try {
            const response = await adminApi.post('/clear-cache');
            return {
                success: true,
                data: response.data,
                message: 'Cache cleared successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: 'Failed to clear cache'
            };
        }
    }
};

// Export the raw axios instance for advanced usage
export { adminApi };

// Export the token for debugging/configuration
export const getAdminToken = () => ADMIN_TOKEN;

// Helper function to format currency
export const formatCurrency = (amount) => {
    return `₹${(amount || 0).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
};

// Helper function to format date
export const formatDate = (dateString) => {
    if (!dateString) return 'N/A';

    const date = new Date(dateString);
    if (isNaN(date)) return dateString;

    return date.toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

// Helper function to format date with time
export const formatDateTime = (dateString) => {
    if (!dateString) return 'N/A';

    const date = new Date(dateString);
    if (isNaN(date)) return dateString;

    return date.toLocaleString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

// Helper function to get status color
export const getStatusColor = (status) => {
    if (!status) return 'gray';

    const statusLower = status.toLowerCase();
    switch (statusLower) {
        case 'pending':
            return 'yellow';
        case 'confirmed':
        case 'completed':
        case 'paid':
            return 'green';
        case 'cancelled':
        case 'rejected':
            return 'red';
        case 'in progress':
        case 'processing':
            return 'blue';
        default:
            return 'gray';
    }
};

// Helper function to validate admin token
export const validateAdminToken = (token) => {
    return token === ADMIN_TOKEN;
};

export default adminService;