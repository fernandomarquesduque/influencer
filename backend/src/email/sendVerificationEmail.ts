/**
 * E-mail de boas-vindas com link para confirmar o endereço de e-mail.
 * Se SMTP não estiver configurado, apenas loga o link no console (desenvolvimento).
 */

const FRONTEND_BASE = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';

/** Roxo sólido (sem gradiente) para boa leitura em Outlook e webmail. */
const BRAND = '#68278f';
const BRAND_DARK = '#4c1d95';
const TEXT = '#1a1a2e';
const TEXT_MUTED = '#374151';
const TEXT_LIGHT = '#6b7280';

export interface SendVerificationEmailOptions {
  to: string;
  subject: string;
  verifyUrl: string;
  bodyText: string;
}

function buildVerificationEmailHtml(verifyUrl: string, bodyText: string): string {
  const escapedUrl = verifyUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const safeBody = bodyText.replace(/</g, '&lt;').replace(/\n/g, '<br>');
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Bem-vindo ao Busca Influencer</title>
</head>
<body style="margin:0; padding:0; background-color:#ececf1; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#ececf1; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 520px; background-color:#ffffff; border-radius: 12px; border: 1px solid #d1d5db;">
          <tr>
            <td align="center" bgcolor="${BRAND}" style="background-color:${BRAND}; padding: 28px 32px 24px; border-radius: 12px 12px 0 0;">
              <div style="font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">Busca Influencer</div>
              <div style="font-size: 14px; color: #ffffff; margin-top: 6px; opacity: 0.95;">Encontre os melhores perfis para sua marca</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 36px 32px 28px;">
              <h1 style="margin:0 0 16px; font-size: 24px; font-weight: 700; color: ${TEXT}; line-height: 1.3;">
                Bem-vindo!
              </h1>
              <p style="margin:0 0 28px; font-size: 16px; color: ${TEXT_MUTED}; line-height: 1.65;">
                ${safeBody}
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin: 0 auto;">
                <tr>
                  <td align="center" bgcolor="${BRAND}" style="background-color:${BRAND}; border-radius: 8px;">
                    <a href="${escapedUrl}" target="_blank" rel="noopener"
                       style="display: inline-block; padding: 16px 36px; font-size: 16px; font-weight: 700; color: #ffffff; background-color: ${BRAND}; text-decoration: none; border-radius: 8px; mso-padding-alt: 0;">
                      <span style="color: #ffffff;">Confirmar e-mail</span>
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 28px 0 8px; font-size: 14px; color: ${TEXT_LIGHT}; line-height: 1.5;">
                Se o botão não abrir, copie e cole este link no navegador:
              </p>
              <p style="margin:0; font-size: 13px; line-height: 1.5; word-break: break-all;">
                <a href="${escapedUrl}" style="color: ${BRAND_DARK}; font-weight: 600;">${escapedUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px 24px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; border-radius: 0 0 12px 12px;">
              <p style="margin:0; font-size: 13px; color: ${TEXT_LIGHT}; text-align: center; line-height: 1.5;">
                Você recebeu este e-mail porque se cadastrou no Busca Influencer.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export interface SendVerificationEmailResult {
  sent: boolean;
  error?: string;
}

/** Envia e-mail com link de verificação. Se SMTP ausente, loga o link. Sempre loga o link para facilitar testes. */
export async function sendVerificationEmail(options: SendVerificationEmailOptions): Promise<SendVerificationEmailResult> {
  const { to, subject, verifyUrl, bodyText } = options;
  const fullUrl = verifyUrl.startsWith('http') ? verifyUrl : `${FRONTEND_BASE.replace(/\/$/, '')}${verifyUrl.startsWith('/') ? '' : '/'}${verifyUrl}`;

  console.log('[email] Link de ativação (copie para testar):', fullUrl);

  const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST;
  const smtpUser = process.env.SMTP_USER || process.env.MAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = await import('nodemailer');
      const port = Number(process.env.SMTP_PORT) || 587;
      const transporter = nodemailer.default.createTransport({
        host: smtpHost,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });
      const html = buildVerificationEmailHtml(fullUrl, bodyText);
      await transporter.sendMail({
        from: process.env.MAIL_FROM || smtpUser,
        to,
        subject,
        text: `${bodyText}\n\nLink para confirmar seu e-mail: ${fullUrl}`,
        html,
      });
      return { sent: true };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('[email] Falha ao enviar:', e);
      console.log('[email] Link de verificação (fallback):', fullUrl);
      return { sent: false, error: errMsg };
    }
  }

  console.log('[email] SMTP não configurado. Link de verificação para', to, ':', fullUrl);
  return { sent: false, error: 'SMTP não configurado' };
}
