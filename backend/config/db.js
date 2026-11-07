const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (dnsErr) {}
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const ATLAS_URI = 'mongodb+srv://proctoai_admin:Subhash75@proctoai.mtrkavh.mongodb.net/test?retryWrites=true&w=majority';
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL || ATLAS_URI;
    console.log(`🔌 [MongoDB] Connecting to MongoDB Atlas cluster...`);

    // Register Mongoose Connection Debug Listeners
    mongoose.connection.removeAllListeners();
    mongoose.connection.on('connected', () => {
      console.log('✅ [MongoDB Debug] Mongoose default connection open');
    });
    mongoose.connection.on('error', (err) => {
      console.error('❌ [MongoDB Debug] Mongoose default connection error:', err.message);
    });
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ [MongoDB Debug] Mongoose default connection disconnected');
    });

    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ [MongoDB] Connected Successfully to Host: ${conn.connection.host} [DB: ${conn.connection.name}]`);
    return conn;
  } catch (error) {
    console.error(`❌ [MongoDB] Connection Failed (${error.message}). Operating in High-Availability In-Memory Fallback Mode.`);
    return null;
  }
};

module.exports = connectDB;
