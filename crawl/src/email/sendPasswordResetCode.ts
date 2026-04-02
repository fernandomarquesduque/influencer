/**
 * E-mail com código de 6 dígitos para redefinição de senha (contas assinante / agência).
 * Se SMTP não estiver configurado, apenas loga o código no console.
 */

const FRONTEND_BASE = process.env.FRONTEND_BASE_URL || process.env.VITE_APP_URL || 'http://localhost:5173';

export interface SendPasswordResetCodeOptions {
  to: string;
  code: string;
}

export interface SendPasswordResetCodeResult {
  sent: boolean;
  error?: string;
}

function buildHtml(code: string): string {
  const safe = code.replace(/</g, '&lt;').replace(/&/g, '&amp;');
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Código para redefinir senha</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background:#ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background: linear-gradient(135deg, #68278f 0%, #4c1d95 100%); padding: 28px 32px 24px; text-align: center;">
              <div style="font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">Busca Influencer</div>
              <div style="font-size: 13px; color: rgba(255,255,255,0.9); margin-top: 4px;">Redefinição de senha</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 32px 28px;">
              <h1 style="margin:0 0 12px; font-size: 20px; font-weight: 700; color: #1f2937;">Seu código de verificação</h1>
              <p style="margin:0 0 24px; font-size: 15px; color: #4b5563; line-height: 1.6;">
                Use o código abaixo na tela de recuperação de senha. Ele expira em 15 minutos.
              </p>
              <div style="text-align: center; padding: 20px; background: #f3f4f6; border-radius: 12px; letter-spacing: 0.35em; font-size: 28px; font-weight: 700; color: #1a1a2e; font-family: ui-monospace, monospace;">
                ${safe}
              </div>
              <p style="margin: 24px 0 0; font-size: 13px; color: #9ca3af;">
                Se você não pediu para redefinir a senha, ignore este e-mail.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin:0; font-size: 12px; color: #9ca3af; text-align: center;">
                <a href="${FRONTEND_BASE.replace(/"/g, '&quot;')}" style="color: #68278f;">Busca Influencer</a>
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

export async function sendPasswordResetCode(options: SendPasswordResetCodeOptions): Promise<SendPasswordResetCodeResult> {
  const { to, code } = options;
  console.log('[email] Código de redefinição de senha para', to, ':', code);

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
      const html = buildHtml(code);
      await transporter.sendMail({
        from: process.env.MAIL_FROM || smtpUser,
        to,
        subject: 'Código para redefinir sua senha — Busca Influencer',
        text: `Seu código para redefinir a senha: ${code}\n\nVálido por 15 minutos. Se não foi você, ignore este e-mail.`,
        html,
      });
      return { sent: true };
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error('[email] Falha ao enviar código de senha:', e);
      return { sent: false, error: errMsg };
    }
  }

  console.log('[email] SMTP não configurado. Código para', to, ':', code);
  return { sent: false, error: 'SMTP não configurado' };
}
