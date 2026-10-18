const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

// Load environment variables reliably regardless of cwd or import order
const envPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(process.cwd(), '.env')
];
for (const p of envPaths) {
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
  }
}

function normalizeEmailCredential(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, '');
}

let cachedTransporter = null;

/**
 * Returns a robust Nodemailer Transporter instance for Gmail.
 * Uses service: 'gmail' with standard secure TLS.
 */
function getTransporter() {
  const emailUser = normalizeEmailCredential(process.env.EMAIL_USER);
  const emailPass = normalizeEmailCredential(process.env.EMAIL_APP_PASSWORD || process.env.EMAIL_PASS);

  if (!emailUser || !emailPass) {
    return null;
  }

  if (cachedTransporter) {
    return cachedTransporter;
  }

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true' || false,
    auth: {
      user: emailUser,
      pass: emailPass
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 4000, // Fast 4s timeout so cloud firewall blocks fail fast
    greetingTimeout: 2500,
    socketTimeout: 5000
  });

  return cachedTransporter;
}

/**
 * Send Real-Time OTP Email via Nodemailer
 * @param {string} toEmail
 * @param {string} studentName
 * @param {string} otpCode
 * @param {string} [customSubject]
 * @param {string} [purposeText]
 * @returns {Promise<boolean>}
 */
async function sendOtpEmail(toEmail, studentName, otpCode, customSubject, purposeText) {
  const transporter = getTransporter();

  const subject = customSubject || 'Athena Smart Proctoring - Verification OTP';
  const actionDescription = purposeText || 'Your One-Time Password (OTP) for Athena Smart Proctoring is:';

  // Check for HTTPS email API key (Resend - uses Port 443, immune to cloud SMTP blocks)
  if (process.env.RESEND_API_KEY) {
    try {
      const axios = require('axios');
      const fromEmail = process.env.EMAIL_FROM || 'Athena Proctoring <onboarding@resend.dev>';
      const resendRes = await axios.post(
        'https://api.resend.com/emails',
        {
          from: fromEmail,
          to: [toEmail],
          subject: subject,
          html: htmlContent
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 6000
        }
      );
      console.log(`✉️ Real-time OTP delivered via Resend HTTPS to ${toEmail}. ID: ${resendRes.data?.id}`);
      return {
        success: true,
        delivered: true,
        messageId: resendRes.data?.id,
        otpCode
      };
    } catch (resendErr) {
      console.warn('Resend HTTPS notice:', resendErr.response?.data?.message || resendErr.message);
    }
  }

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
          ${actionDescription}
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

  const emailUser = normalizeEmailCredential(process.env.EMAIL_USER);

  if (!transporter) {
    const reason = 'EMAIL_USER & EMAIL_APP_PASSWORD are not configured in environment';
    console.warn(`⚠️ ${reason}. Real-time OTP [${otpCode}] created for ${toEmail}`);
    return {
      success: false,
      delivered: false,
      reason,
      otpCode
    };
  }

  const mailOptions = {
    from: `"Athena Smart Proctoring" <${emailUser || 'athena@localhost'}>`,
    to: toEmail,
    subject: subject,
    html: htmlContent,
    text: `Hello ${studentName},\n\n${actionDescription} ${otpCode}\n\nThis OTP is valid for 5 minutes. If you do not see this email in your inbox, please check your spam or junk folder.\n\nRegards,\nAthena Smart Proctoring Team`
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ Real-time OTP email delivered to ${toEmail}. Message ID: ${info.messageId}`);
    return {
      success: true,
      delivered: true,
      messageId: info.messageId,
      otpCode
    };
  } catch (error) {
    console.error(`OTP email delivery failed for ${toEmail}:`, error.message);
    return {
      success: false,
      delivered: false,
      reason: error.message,
      otpCode
    };
  }
}

module.exports = {
  sendOtpEmail,
  normalizeEmailCredential
};
