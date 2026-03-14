import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Connection state tracking
let isConnected = false;
let connectionAttempts = 0;
const MAX_RETRIES = 3;

// Connection options with best practices
const connectionOptions = {
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  minPoolSize: 5,
  maxIdleTimeMS: 30000,
  retryWrites: true,
  w: 'majority'
};

// MongoDB connection URI
const getMongoURI = () => {
  // Check for MongoDB URI in environment variables
  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoURI) {
    console.error('❌ MongoDB URI not found in environment variables');
    console.error('Please set MONGO_URI or MONGODB_URI in your .env file');

    // Provide helpful suggestions
    const suggestions = [
      'mongodb://localhost:27017/homax (local development)',
      'mongodb+srv://username:password@cluster.mongodb.net/dbname (MongoDB Atlas)',
      'mongodb://user:pass@host:port/database (standard connection)'
    ];

    console.error('\n💡 Example connection strings:');
    suggestions.forEach(s => console.error(`  - ${s}`));

    throw new Error('MongoDB connection URI is required');
  }

  // Log connection type (for debugging)
  if (process.env.NODE_ENV === 'development') {
    if (mongoURI.includes('localhost') || mongoURI.includes('127.0.0.1')) {
      console.log('🔗 Connecting to local MongoDB');
    } else if (mongoURI.includes('mongodb+srv://')) {
      console.log('☁️  Connecting to MongoDB Atlas');
    } else {
      console.log('🔌 Connecting to MongoDB instance');
    }
  }

  return mongoURI;
};

// Connection event handlers
const setupConnectionEvents = () => {
  mongoose.connection.on('connected', () => {
    isConnected = true;
    connectionAttempts = 0;
    console.log('✅ MongoDB connection established');
  });

  mongoose.connection.on('error', (err) => {
    console.error(`❌ MongoDB connection error: ${err.message}`);
    isConnected = false;

    // Log specific error details
    if (err.name === 'MongoNetworkError') {
      console.error('⚠️  Network error - Check if MongoDB is running and accessible');
    } else if (err.name === 'MongooseServerSelectionError') {
      console.error('⚠️  Server selection error - Check connection string and network');
    } else if (err.name === 'MongoParseError') {
      console.error('⚠️  Connection string parse error - Check MONGO_URI format');
    }
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    console.log('⚠️  MongoDB connection lost');

    // Attempt reconnection in production
    if (process.env.NODE_ENV === 'production') {
      console.log('🔄 Attempting to reconnect...');
      setTimeout(connectDB, 5000);
    }
  });

  mongoose.connection.on('reconnected', () => {
    isConnected = true;
    console.log('🔁 MongoDB reconnected');
  });

  mongoose.connection.on('close', () => {
    console.log('🔌 MongoDB connection closed');
  });
};

// Health check function
export const checkDatabaseHealth = () => {
  const state = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  return {
    status: state === 1 ? 'healthy' : 'unhealthy',
    state: states[state] || 'unknown',
    isConnected: state === 1,
    host: mongoose.connection.host || 'unknown',
    name: mongoose.connection.name || 'unknown',
    readyState: state
  };
};

// Main connection function
const connectDB = async () => {
  try {
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      console.log('ℹ️  MongoDB already connected');
      return mongoose.connection;
    }

    // Prevent multiple connection attempts
    if (mongoose.connection.readyState === 2) {
      console.log('⏳ MongoDB connection in progress...');
      return new Promise((resolve, reject) => {
        mongoose.connection.once('connected', () => resolve(mongoose.connection));
        mongoose.connection.once('error', reject);
      });
    }

    connectionAttempts++;

    if (connectionAttempts > MAX_RETRIES) {
      console.error(`❌ Maximum connection attempts (${MAX_RETRIES}) exceeded`);
      throw new Error('Maximum connection attempts exceeded');
    }

    console.log(`🔌 Attempting MongoDB connection (attempt ${connectionAttempts}/${MAX_RETRIES})...`);

    // Get connection URI
    const mongoURI = getMongoURI();

    // Setup event handlers (only once)
    if (!mongoose.connection.listeners('connected').length) {
      setupConnectionEvents();
    }

    // Connect to MongoDB
    const conn = await mongoose.connect(mongoURI, connectionOptions);

    console.log(`✅ MongoDB Connected Successfully!`);
    console.log(`   Host: ${conn.connection.host}`);
    console.log(`   Database: ${conn.connection.name}`);
    console.log(`   Remote Database Port: ${conn.connection.port}`);
    console.log(`   State: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);

    // Log additional info in development
    if (process.env.NODE_ENV === 'development') {
      const collections = await mongoose.connection.db.listCollections().toArray();
      console.log(`   Collections: ${collections.length}`);

      // List collections (first 5)
      if (collections.length > 0) {
        console.log('   Available collections:');
        collections.slice(0, 5).forEach(col => {
          console.log(`     - ${col.name}`);
        });
        if (collections.length > 5) {
          console.log(`     ... and ${collections.length - 5} more`);
        }
      }
    }

    isConnected = true;
    connectionAttempts = 0;

    return conn;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error (Attempt ${connectionAttempts}/${MAX_RETRIES}):`);
    console.error(`   Error: ${error.message}`);

    // Provide specific troubleshooting tips
    if (error.message.includes('ENOTFOUND')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - Check if the hostname in MONGO_URI is correct');
      console.error('   - Verify DNS resolution');
      console.error('   - Check network connectivity');
    } else if (error.message.includes('ETIMEDOUT')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - MongoDB server might be down');
      console.error('   - Check firewall settings');
      console.error('   - Verify port accessibility');
    } else if (error.message.includes('Authentication failed')) {
      console.error('\n💡 Troubleshooting:');
      console.error('   - Check username and password in MONGO_URI');
      console.error('   - Verify database user permissions');
      console.error('   - Check if authentication database is correct');
    }

    // Only exit in production for critical errors
    if (process.env.NODE_ENV === 'production') {
      if (connectionAttempts >= MAX_RETRIES) {
        console.error('💥 Fatal: Could not connect to MongoDB after maximum retries');
        process.exit(1);
      } else {
        // Retry connection after delay
        const retryDelay = Math.min(1000 * Math.pow(2, connectionAttempts), 10000);
        console.log(`🔄 Retrying connection in ${retryDelay / 1000} seconds...`);
        setTimeout(connectDB, retryDelay);
      }
    } else {
      // In development, throw error for debugging
      throw error;
    }
  }
};

// Graceful shutdown
export const disconnectDB = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('✅ MongoDB connection closed gracefully');
    }
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error.message);
  }
};

// Connection status getter
export const getConnectionStatus = () => {
  return {
    isConnected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    port: mongoose.connection.port,
    name: mongoose.connection.name,
    connectionAttempts,
    models: Object.keys(mongoose.models).length
  };
};

// Export the main connection function
export default connectDB;

// Export mongoose for direct use if needed
export { mongoose };