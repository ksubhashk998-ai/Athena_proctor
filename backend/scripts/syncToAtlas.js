/**
 * syncToAtlas.js
 * Synchronizes all existing local MongoDB collections to MongoDB Atlas.
 * Run: node scripts/syncToAtlas.js "<your-atlas-uri>"
 */
const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (dnsErr) {}
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const LOCAL_URI = 'mongodb://127.0.0.1:27017/smart-proctoring';
const ATLAS_URI = process.argv[2] || process.env.MONGODB_URI;

if (!ATLAS_URI || !ATLAS_URI.includes('mongodb+srv') && !ATLAS_URI.includes('mongodb.net')) {
  console.error('❌ Error: Please provide your MongoDB Atlas URI.');
  console.log('Usage: node scripts/syncToAtlas.js "mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<db>?retryWrites=true&w=majority"');
  process.exit(1);
}

async function sync() {
  console.log('🔄 Connecting to Local MongoDB...');
  const localConn = await mongoose.createConnection(LOCAL_URI, { serverSelectionTimeoutMS: 5000 }).asPromise();
  console.log('✅ Connected to Local MongoDB.');

  console.log('☁️ Connecting to MongoDB Atlas...');
  const atlasConn = await mongoose.createConnection(ATLAS_URI, { serverSelectionTimeoutMS: 15000 }).asPromise();
  console.log(`✅ Connected to MongoDB Atlas [Database: ${atlasConn.name}].`);

  const collections = await localConn.db.listCollections().toArray();
  console.log(`📦 Found ${collections.length} collections in local database.`);

  for (const col of collections) {
    const colName = col.name;
    const count = await localConn.db.collection(colName).countDocuments();
    if (count === 0) continue;

    console.log(`⏳ Syncing ${count} documents from '${colName}' to Atlas...`);
    const docs = await localConn.db.collection(colName).find({}).toArray();

    const atlasCol = atlasConn.db.collection(colName);
    let synced = 0;
    for (const doc of docs) {
      try {
        let filter = { _id: doc._id };
        if (doc.sessionId && colName === 'live_sessions') filter = { sessionId: doc.sessionId };
        else if (doc.studentId && ['students', 'faceprofiles', 'faceembeddings'].includes(colName)) filter = { studentId: doc.studentId };
        else if (doc.alertId) filter = { alertId: doc.alertId };
        else if (doc.violationId) filter = { violationId: doc.violationId };

        const { _id, ...updateData } = doc;
        await atlasCol.updateOne(filter, { $set: updateData }, { upsert: true });
        synced++;
      } catch (docErr) {
        try {
          await atlasCol.insertOne(doc);
          synced++;
        } catch (ign) {}
      }
    }
    console.log(`✅ '${colName}' successfully synchronized (${synced}/${count} records).`);
  }

  // Ensure default Admin exists in Atlas
  const AdminModel = atlasConn.model('Admin', require('../models/Admin').schema);
  const existingAdmin = await AdminModel.findOne({ email: 'admin@proctor.com' });
  if (!existingAdmin) {
    await AdminModel.create({
      name: 'System Administrator',
      email: 'admin@proctor.com',
      password: 'Admin@123',
      role: 'superadmin',
      department: 'Exam Control Center'
    });
    console.log('✅ Default superadmin created in Atlas admins collection: admin@proctor.com');
  }

  console.log('\n🎉 ALL LOCAL DATA SUCCESSFULLY SYNCHRONIZED TO MONGODB ATLAS!');
  await localConn.close();
  await atlasConn.close();
  process.exit(0);
}

sync().catch(err => {
  console.error('❌ Sync failed:', err.message);
  process.exit(1);
});
