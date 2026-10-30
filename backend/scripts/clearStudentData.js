const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const mongoose = require('mongoose');
require('dotenv').config({ path: './backend/.env' });

async function clearStudent() {
  const targetEmail = 'ksubhashk998@gmail.com';
  const targetStudentId = 'STU_ksubhashk998_gmail_com';

  console.log(`🔌 Connecting to MongoDB Atlas for ${targetEmail}...`);
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const collections = [
    { name: 'students', query: { $or: [{ email: targetEmail }, { studentId: targetStudentId }] } },
    { name: 'faceembeddings', query: { $or: [{ email: targetEmail }, { studentId: targetStudentId }] } },
    { name: 'faceprofiles', query: { $or: [{ email: targetEmail }, { studentId: targetStudentId }] } },
    { name: 'users', query: { email: targetEmail } },
    { name: 'live_sessions', query: { $or: [{ studentEmail: targetEmail }, { email: targetEmail }, { studentId: targetStudentId }] } },
    { name: 'incidents', query: { $or: [{ studentEmail: targetEmail }, { email: targetEmail }, { studentId: targetStudentId }] } },
    { name: 'exam_reports', query: { $or: [{ studentEmail: targetEmail }, { email: targetEmail }, { studentId: targetStudentId }] } },
    { name: 'verificationlogs', query: { $or: [{ studentEmail: targetEmail }, { email: targetEmail }, { studentId: targetStudentId }] } },
    { name: 'otps', query: { email: targetEmail } }
  ];

  console.log('\n🧹 Purging records:');
  for (const item of collections) {
    try {
      const col = db.collection(item.name);
      const res = await col.deleteMany(item.query);
      console.log(`  - ${item.name}: deleted ${res.deletedCount} documents`);
    } catch (e) {
      console.log(`  - ${item.name}: ${e.message}`);
    }
  }

  console.log('\n✅ Successfully removed student records from MongoDB Atlas.');
  process.exit(0);
}

clearStudent().catch(err => {
  console.error('❌ Error during purge:', err);
  process.exit(1);
});
