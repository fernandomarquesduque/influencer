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

function buildVerificationEmailHtml(verifyUrl: string, bodyText: string): string {
  const escapedUrl = verifyUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Valide seu e-mail</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 480px; background:#ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 32px 32px 28px; text-align: center;">
              <div style="font-size: 28px; font-weight: 700; color: #ffffff; letter-spacing: -0.02em;">Busca Influencer</div>
              <div style="font-size: 13px; color: rgba(255,255,255,0.9); margin-top: 4px;">Encontre os melhores perfis para sua marca</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 32px 24px;">
              <h1 style="margin:0 0 12px; font-size: 22px; font-weight: 700; color: #1f2937; line-height: 1.3;">
                Seus 5 créditos grátis estão esperando
              </h1>
              <p style="margin:0 0 20px; font-size: 16px; color: #4b5563; line-height: 1.6;">
                ${bodyText.replace(/</g, '&lt;').replace(/\n/g, '<br>')}
              </p>
              <p style="margin:0 0 24px; font-size: 15px; color: #6b7280; line-height: 1.5;">
                É rápido: um clique e você libera relatórios com dados de engajamento, seguidores e ativação de influenciadores.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center">
                <tr>
                  <td style="border-radius: 10px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);">
                    <a href="${escapedUrl}" target="_blank" rel="noopener" style="display: inline-block; padding: 16px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">
                      Validar e-mail e liberar créditos →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 13px; color: #9ca3af;">
                Se o botão não abrir, copie e cole no navegador:<br>
                <a href="${escapedUrl}" style="color: #6366f1; word-break: break-all;">${escapedUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb;">
              <p style="margin:0; font-size: 12px; color: #9ca3af; text-align: center;">
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
        text: `${bodyText}\n\nLink para validar: ${fullUrl}`,
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
