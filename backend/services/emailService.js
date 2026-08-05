const nodemailer = require('nodemailer');

function normalizeEmailCredential(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, '');
}

/**
 * Create Nodemailer Transporter using environment variables
 */
function createTransporter() {
  const emailUser = normalizeEmailCredential(process.env.EMAIL_USER);
  const emailPass = normalizeEmailCredential(process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS);

  if (emailUser && emailPass) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }
  return null;
}

/**
 * Send Real-Time OTP Email via Nodemailer
 * @param {string} toEmail
 * @param {string} studentName
 * @param {string} otpCode
 * @returns {Promise<boolean>}
 */
async function sendOtpEmail(toEmail, studentName, otpCode) {
  const transporter = createTransporter();

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #070c18; padding: 40px 20px; color: #f8fafc;">
      <div style="max-width: 520px; margin: 0 auto; background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 32px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
        
        <!-- Header Logo -->
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; width: 54px; height: 54px; background: linear-gradient(135deg, #6366f1, #4f46e5); border-radius: 50%; line-height: 54px; font-size: 24px;">
            🛡️
          </div>
          <h2 style="margin: 12px 0 4px 0; color: #ffffff; font-size: 22px; font-weight: 800;">Athena Smart Proctoring</h2>
          <span style="color: #818cf8; font-size: 13px; font-weight: 600;">Enterprise AI Examination Suite</span>
        </div>

        <hr style="border: 0; border-top: 1px solid #1e293b; margin: 20px 0;" />

        <p style="font-size: 15px; color: #cbd5e1; margin-bottom: 8px;">Hello <strong style="color: #ffffff;">${studentName}</strong>,</p>
        <p style="font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px;">
          Your One-Time Password (OTP) for logging into Athena Smart Proctoring is:
        </p>

        <!-- OTP Badge Container -->
        <div style="background: linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.9)); border: 2px dashed #4f46e5; border-radius: 14px; padding: 20px 12px; text-align: center; margin-bottom: 24px;">
          <span style="font-family: 'Consolas', 'Courier New', monospace; font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #34d399; display: inline-block; white-space: nowrap; word-break: keep-all;">
            ${otpCode}
          </span>
          <span style="display: block; font-size: 12px; color: #94a3b8; margin-top: 10px;">
            ⏳ Valid for <strong>5 minutes</strong> • Single Use Only
          </span>
        </div>

        <p style="font-size: 13px; color: #94a3b8; line-height: 1.5; margin-bottom: 24px;">
          If you did not request this OTP, please ignore this email. Do not share this security code with anyone.
        </p>

        <hr style="border: 0; border-top: 1px solid #1e293b; margin: 20px 0;" />

        <div style="text-align: center; font-size: 12px; color: #64748b;">
          Regards,<br />
          <strong style="color: #cbd5e1;">Athena Smart Proctoring Team</strong>
        </div>
      </div>
    </div>
  `;

  if (!transporter) {
    console.warn(`⚠️ EMAIL_USER & EMAIL_APP_PASSWORD not set in .env. Real-time OTP [${otpCode}] created for ${toEmail}`);
    return true;
  }

  const mailOptions = {
    from: `"Athena Smart Proctoring" <${normalizeEmailCredential(process.env.EMAIL_USER) || 'athena@localhost'}>`,
    to: toEmail,
    subject: 'Athena Smart Proctoring - Login Verification OTP',
    html: htmlContent,
    text: `Hello ${studentName},\n\nYour OTP for logging into Athena Smart Proctoring is: ${otpCode}\n\nThis OTP is valid for 5 minutes.\n\nRegards,\nAthena Smart Proctoring Team`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Real-time OTP email delivered to ${toEmail}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('OTP email delivery failed:', error.message);
    throw new Error(`Failed to send OTP email: ${error.message}`);
  }
}

module.exports = {
  sendOtpEmail,
  normalizeEmailCredential
};
