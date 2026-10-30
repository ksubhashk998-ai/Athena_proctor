const dns = require('dns');
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {}
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function backfill() {
  const conn = await mongoose.connect(process.env.MONGODB_URI);
  const db = conn.connection.db;

  const acts = await db.collection('suspiciousactivities').find({}).limit(50).toArray();
  console.log(`Populating violations and alerts from ${acts.length} activities...`);

  for (const a of acts) {
    const vId = 'VIOL_' + String(a._id);
    const aId = 'ALT_' + String(a._id);
    const sId = a.studentId || 'STU_1001';
    const sName = a.studentEmail ? a.studentEmail.split('@')[0] : 'Student';
    const vType = a.violationType || a.type || 'LOOKING_AWAY';

    await db.collection('violations').updateOne(
      { violationId: vId },
      {
        $set: {
          violationId: vId,
          sessionId: a.sessionId || `sess_${sId}`,
          studentId: sId,
          studentName: sName,
          examName: 'Computer Science Final Assessment',
          type: vType,
          description: a.description || 'Proctoring violation recorded',
          severity: a.severity === 'critical' ? 'Critical' : 'High',
          screenshotUrl: a.screenshotPath || a.screenshotBase64 || '',
          timestamp: a.timestamp || new Date()
        }
      },
      { upsert: true }
    );

    await db.collection('alerts').updateOne(
      { alertId: aId },
      {
        $set: {
          alertId: aId,
          sessionId: a.sessionId || `sess_${sId}`,
          studentId: sId,
          studentName: sName,
          examName: 'Computer Science Final Assessment',
          alertType: vType,
          message: a.description || 'Proctoring Alert Detected',
          severity: a.severity === 'critical' ? 'Critical' : 'High',
          timestamp: a.timestamp || new Date()
        }
      },
      { upsert: true }
    );
  }

  // Ensure default superadmin
  const AdminModel = mongoose.models.Admin || require('../models/Admin');
  const existingAdmin = await AdminModel.findOne({ email: 'admin@proctor.com' });
  if (!existingAdmin) {
    await new AdminModel({
      name: 'System Administrator',
      email: 'admin@proctor.com',
      password: 'Admin@123',
      role: 'superadmin',
      department: 'Exam Control Center'
    }).save();
    console.log('✅ Admin ensured in Atlas');
  }

  // Print all collection document counts in Atlas
  console.log('\n📊 Current MongoDB Atlas Document Counts:');
  const colls = await db.listCollections().toArray();
  for (const col of colls) {
    const count = await db.collection(col.name).countDocuments();
    console.log(` - ${col.name}: ${count} documents`);
  }

  await conn.disconnect();
  process.exit(0);
}

backfill().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
