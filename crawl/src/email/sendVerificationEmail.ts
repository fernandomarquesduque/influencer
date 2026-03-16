/**
 * Envio de e-mail de validação (link para verificar e-mail ou para missão Instagram).
 * Se SMTP não estiver configurado, apenas loga o link no console (desenvolvimento).
 */

const FRONTEND_BASE = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';

export interface SendVerificationEmailOptions {
  to: string;
  subject: string;
  verifyUrl: string;
  bodyText: string;
}

/** Envia e-mail com link de verificação. Se SMTP ausente, loga o link. Sempre loga o link para facilitar testes. */
export async function sendVerificationEmail(options: SendVerificationEmailOptions): Promise<void> {
  const { to, subject, verifyUrl, bodyText } = options;
  const fullUrl = verifyUrl.startsWith('http') ? verifyUrl : `${FRONTEND_BASE.replace(/\/$/, '')}${verifyUrl.startsWith('/') ? '' : '/'}${verifyUrl}`;

  console.log('[email] Link de ativação (copie para testar):', fullUrl);

  const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const smtpUser = process.env.SMTP_USER || process.env.MAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: smtpUser, pass: smtpPass },
      });
      await transporter.sendMail({
        from: process.env.MAIL_FROM || smtpUser,
        to,
        subject,
        text: `${bodyText}\n\nLink: ${fullUrl}`,
        html: `<p>${bodyText.replace(/\n/g, '<br>')}</p><p><a href="${fullUrl}">Clique aqui para validar</a></p>`,
      });
      return;
    } catch (e) {
      console.error('[email] Falha ao enviar:', e);
      console.log('[email] Link de verificação (fallback):', fullUrl);
      return;
    }
  }

  console.log('[email] SMTP não configurado. Link de verificação para', to, ':', fullUrl);
}
