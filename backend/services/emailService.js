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

  if (!process.env.SMTP_HOST || process.env.SMTP_HOST === 'smtp.gmail.com') {
    cachedTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      },
      connectionTimeout: 5000,
      greetingTimeout: 3500,
      socketTimeout: 5000
    });
  } else {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true' || false,
      auth: {
        user: emailUser,
        pass: emailPass
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 5000,
      greetingTimeout: 3500,
      socketTimeout: 5000
    });
  }

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

  let lastFailureReason = '';

  // 1. Check for Brevo HTTPS API Key (Port 443 - 100% bypasses cloud SMTP restrictions)
  if (process.env.BREVO_API_KEY) {
    try {
      const axios = require('axios');
      const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'ksubhashk998@gmail.com';
      const brevoRes = await axios.post(
        'https://api.brevo.com/v3/smtp/email',
        {
          sender: { name: 'Athena Proctoring', email: senderEmail },
          to: [{ email: toEmail, name: studentName }],
          subject: subject,
          htmlContent: htmlContent
        },
        {
          headers: {
            'api-key': process.env.BREVO_API_KEY,
            'Content-Type': 'application/json'
          },
          timeout: 7000
        }
      );
      console.log(`✉️ Real-time OTP delivered via Brevo HTTPS to ${toEmail}. Message ID: ${brevoRes.data?.messageId}`);
      return {
        success: true,
        delivered: true,
        channel: 'brevo_https',
        messageId: brevoRes.data?.messageId,
        otpCode
      };
    } catch (brevoErr) {
      lastFailureReason = `Brevo HTTPS error: ${brevoErr.response?.data?.message || brevoErr.message}`;
      console.warn(lastFailureReason);
    }
  }

  // 2. Check for Resend HTTPS API Key (Port 443 - 100% bypasses cloud SMTP restrictions)
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
          timeout: 7000
        }
      );
      console.log(`✉️ Real-time OTP delivered via Resend HTTPS to ${toEmail}. ID: ${resendRes.data?.id}`);
      return {
        success: true,
        delivered: true,
        channel: 'resend_https',
        messageId: resendRes.data?.id,
        otpCode
      };
    } catch (resendErr) {
      lastFailureReason = `Resend HTTPS error: ${resendErr.response?.data?.message || resendErr.message}`;
      console.warn(lastFailureReason);
    }
  }

  // 3. Check for SendGrid HTTPS API Key (Port 443 - 100% bypasses cloud SMTP restrictions)
  if (process.env.SENDGRID_API_KEY) {
    try {
      const axios = require('axios');
      const senderEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'ksubhashk998@gmail.com';
      const sendgridRes = await axios.post(
        'https://api.sendgrid.com/v3/mail/send',
        {
          personalizations: [{ to: [{ email: toEmail, name: studentName }] }],
          from: { email: senderEmail, name: 'Athena Proctoring' },
          subject: subject,
          content: [{ type: 'text/html', value: htmlContent }]
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 7000
        }
      );
      const msgId = sendgridRes.headers?.['x-message-id'] || 'sendgrid-' + Date.now();
      console.log(`✉️ Real-time OTP delivered via SendGrid HTTPS to ${toEmail}. Message ID: ${msgId}`);
      return {
        success: true,
        delivered: true,
        channel: 'sendgrid_https',
        messageId: msgId,
        otpCode
      };
    } catch (sendgridErr) {
      lastFailureReason = `SendGrid HTTPS error: ${sendgridErr.response?.data?.errors?.[0]?.message || sendgridErr.message}`;
      console.warn(lastFailureReason);
    }
  }

  const emailUser = normalizeEmailCredential(process.env.EMAIL_USER);

  if (!transporter) {
    const reason = 'EMAIL_USER & EMAIL_APP_PASSWORD are not configured in environment';
    console.warn(`⚠️ ${reason}. Real-time OTP [${otpCode}] created for ${toEmail}`);
    return {
      success: false,
      delivered: false,
      reason: lastFailureReason || reason,
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
    console.log(`✉️ Real-time OTP email delivered via SMTP to ${toEmail}. Message ID: ${info.messageId}`);
    return {
      success: true,
      delivered: true,
      channel: 'smtp',
      messageId: info.messageId,
      otpCode
    };
  } catch (error) {
    const isTimeout = error.message?.includes('timeout') || error.code === 'ETIMEDOUT';
    const failureReason = isTimeout
      ? 'Outbound SMTP port blocked or timed out on cloud host. (Use Brevo or Resend HTTPS API key for cloud email delivery).'
      : error.message;
    console.error(`OTP email delivery failed for ${toEmail}:`, failureReason);
    return {
      success: false,
      delivered: false,
      reason: failureReason,
      otpCode
    };
  }
}

module.exports = {
  sendOtpEmail,
  normalizeEmailCredential
};
