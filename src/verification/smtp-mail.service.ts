import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { basename, extname, resolve } from 'node:path';
import { connect as connectTls, TLSSocket } from 'node:tls';

type MailSocket = Socket | TLSSocket;

type InlineLogo = {
  contentBase64: string;
  mimeType: string;
  fileName: string;
};

@Injectable()
export class SmtpMailService {
  private readonly logger = new Logger(SmtpMailService.name);

  constructor(private readonly configService: ConfigService) {}

  async sendOtpEmail(
    toEmail: string,
    otp: string,
    expiresInMinutes = 3
  ): Promise<void> {
    const subject = 'Your NexusFlow email verification code';
    const textBody = [
      'Your NexusFlow verification code is:',
      otp,
      '',
      `It will expire in ${expiresInMinutes} minutes.`,
      'If you did not request this, you can ignore this email.',
    ].join('\r\n');
    await this.dispatchOtpEmail({
      toEmail,
      otp,
      subject,
      textBody,
      htmlBuilder: (includeLogo) =>
        this.buildVerificationHtmlBody(otp, includeLogo, expiresInMinutes),
    });
  }

  async sendPasswordResetOtpEmail(
    toEmail: string,
    otp: string,
    expiresInMinutes = 3
  ): Promise<void> {
    const subject = 'Your NexusFlow password reset code';
    const textBody = [
      'Your NexusFlow password reset code is:',
      otp,
      '',
      `It will expire in ${expiresInMinutes} minutes.`,
      'If you did not request this reset, you can ignore this email.',
    ].join('\r\n');
    await this.dispatchOtpEmail({
      toEmail,
      otp,
      subject,
      textBody,
      htmlBuilder: (includeLogo) =>
        this.buildPasswordResetHtmlBody(otp, includeLogo, expiresInMinutes),
    });
  }

  private async dispatchOtpEmail(params: {
    toEmail: string;
    otp: string;
    subject: string;
    textBody: string;
    htmlBuilder: (includeLogo: boolean) => string;
  }): Promise<void> {
    const { toEmail, otp, subject, textBody, htmlBuilder } = params;
    const host = this.configService.get<string>('SMTP_HOST');
    const fromEmail =
      this.configService.get<string>('SMTP_FROM_EMAIL') ??
      this.configService.get<string>('SMTP_USER');
    const port = Number(this.configService.get<string>('SMTP_PORT') ?? 465);
    const username = this.configService.get<string>('SMTP_USER');
    const password = this.configService.get<string>('SMTP_PASS');
    const secure =
      (this.configService.get<string>('SMTP_SECURE') ?? 'true')
        .toLowerCase()
        .trim() !== 'false';

    if (!host || !fromEmail) {
      const logOnlyMode =
        this.configService
          .get<string>('SMTP_LOG_ONLY')
          ?.trim()
          .toLowerCase() === 'true';

      this.logger.error(
        `SMTP is not fully configured (SMTP_HOST/SMTP_FROM_EMAIL). OTP email to ${toEmail} cannot be sent.`
      );

      if (logOnlyMode) {
        this.logger.warn(
          `SMTP_LOG_ONLY=true enabled. OTP for ${toEmail} is ${otp}`
        );
        return;
      }

      throw new ServiceUnavailableException(
        'Email service is not configured. Please contact support.'
      );
    }

    const logo = await this.loadInlineLogo();
    const htmlBody = htmlBuilder(Boolean(logo));
    const data = this.buildMessage({
      fromEmail,
      toEmail,
      subject,
      textBody,
      htmlBody,
      logo,
    });

    const socket = await this.connect(host, port, secure);
    try {
      await this.readResponse(socket);
      await this.sendCommand(socket, 'EHLO nexusflow.local');

      if (username && password) {
        await this.sendCommand(socket, 'AUTH LOGIN');
        await this.sendCommand(
          socket,
          Buffer.from(username, 'utf8').toString('base64')
        );
        await this.sendCommand(
          socket,
          Buffer.from(password, 'utf8').toString('base64')
        );
      }

      await this.sendCommand(socket, `MAIL FROM:<${fromEmail}>`);
      await this.sendCommand(socket, `RCPT TO:<${toEmail}>`);
      await this.sendCommand(socket, 'DATA');
      await this.sendData(socket, data);
      await this.sendCommand(socket, 'QUIT');
    } catch (error) {
      this.logger.error(
        `Failed to send OTP email to ${toEmail}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new ServiceUnavailableException(
        'Failed to send email. Please try again later.'
      );
    } finally {
      socket.end();
    }
  }

  private buildVerificationHtmlBody(
    otp: string,
    includeLogo: boolean,
    expiresInMinutes: number
  ): string {
    return this.buildOtpHtmlBody(
      'Your NexusFlow verification code is:',
      'If you did not request this, you can ignore this email.',
      includeLogo,
      otp,
      expiresInMinutes
    );
  }

  private buildPasswordResetHtmlBody(
    otp: string,
    includeLogo: boolean,
    expiresInMinutes: number
  ): string {
    return this.buildOtpHtmlBody(
      'Your NexusFlow password reset code is:',
      'If you did not request this reset, you can ignore this email.',
      includeLogo,
      otp,
      expiresInMinutes
    );
  }

  private buildOtpHtmlBody(
    headline: string,
    footer: string,
    includeLogo: boolean,
    otp: string,
    expiresInMinutes: number
  ): string {
    const logoSection = includeLogo
      ? [
          '<div style="text-align:center;margin:0 0 18px 0;">',
          '<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 24px auto;border-radius:16px;background:#1ABEAA;background-image:linear-gradient(135deg,#1ABEAA,#22B8D4);">',
          '<tr>',
          '<td align="center" valign="middle" width="80" height="80" style="width:80px;height:80px;border-radius:16px;">',
          '<img src="cid:nexusflow-logo" alt="NexusFlow" width="42" style="display:block;width:42px;max-width:42px;height:auto;border:0;outline:none;text-decoration:none;" />',
          '</td>',
          '</tr>',
          '</table>',
          '</div>',
          '<h1 style="margin:0 0 24px 0;font-size:44px;line-height:1.05;font-weight:700;text-align:center;color:#1ABEAA;">NexusFlow</h1>',
        ].join('')
      : [
          '<div style="text-align:center;margin:0 0 18px 0;">',
          '<div style="display:inline-flex;align-items:center;justify-content:center;width:80px;height:80px;margin:0 0 24px 0;background:#1ABEAA;background-image:linear-gradient(135deg,#1ABEAA,#22B8D4);border-radius:16px;box-shadow:0 0 24px rgba(26,190,170,.25);">',
          '<div role="img" aria-label="NexusFlow icon" style="font-size:28px;line-height:1;font-weight:800;letter-spacing:.04em;color:#091520;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;">NF</div>',
          '</div>',
          '</div>',
          '<h1 style="margin:0 0 24px 0;font-size:44px;line-height:1.05;font-weight:700;text-align:center;color:#1ABEAA;">NexusFlow</h1>',
        ].join('');

    return [
      '<div style="margin:0;padding:24px;background:#091520;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:#D6EAE8;">',
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">',
      '<tr><td align="center">',
      '<div style="max-width:560px;width:100%;margin:0 auto;background:#0E1E2B;border:1px solid #1A2E3D;border-radius:16px;padding:24px;box-sizing:border-box;">',
      logoSection,
      '<p style="margin:0 0 8px 0;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6B96A8;">NexusFlow Security</p>',
      `<p style="margin:0 0 14px 0;font-size:18px;font-weight:600;line-height:1.4;color:#EAF6F5;">${headline}</p>`,
      '<p style="margin:0 0 8px 0;font-size:13px;color:#7FAFC0;">Use this one-time code to continue:</p>',
      '<div style="margin:0 0 14px 0;display:inline-block;background:#1ABEAA;background-image:linear-gradient(135deg,#1ABEAA,#22B8D4);padding:1px;border-radius:12px;">',
      `<div style="background:#0E1E2B;color:#EAF6F5;border-radius:11px;padding:12px 22px;font-size:30px;font-weight:800;letter-spacing:6px;line-height:1;">${otp}</div>`,
      '</div>',
      `<p style="margin:0 0 10px 0;font-size:13px;color:#7FAFC0;">This code expires in <strong style="color:#D6EAE8;">${expiresInMinutes} minutes</strong>.</p>`,
      `<p style="margin:0 0 18px 0;font-size:13px;color:#7FAFC0;">${footer}</p>`,
      '<div style="height:1px;background:#1A2E3D;margin:0 0 14px 0;"></div>',
      '<p style="margin:0;font-size:12px;line-height:1.5;color:#4D7A8A;">For your security, never share this code. NexusFlow support will never ask for your OTP.</p>',
      '</div>',
      '</td></tr>',
      '</table>',
      '</div>',
    ].join('');
  }

  private buildMessage(params: {
    fromEmail: string;
    toEmail: string;
    subject: string;
    textBody: string;
    htmlBody: string;
    logo: InlineLogo | null;
  }): string {
    const { fromEmail, toEmail, subject, textBody, htmlBody, logo } = params;
    const alternativeBoundary = 'boundary_otp_alt';

    if (!logo) {
      return [
        `From: ${fromEmail}`,
        `To: ${toEmail}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
        '',
        `--${alternativeBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        '',
        textBody,
        '',
        `--${alternativeBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        '',
        htmlBody,
        '',
        `--${alternativeBoundary}--`,
      ].join('\r\n');
    }

    const relatedBoundary = 'boundary_otp_related';
    const logoDataWrapped = this.wrapBase64(logo.contentBase64);

    return [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
      '',
      `--${relatedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
      '',
      `--${alternativeBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      textBody,
      '',
      `--${alternativeBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody,
      '',
      `--${alternativeBoundary}--`,
      '',
      `--${relatedBoundary}`,
      `Content-Type: ${logo.mimeType}; name="${logo.fileName}"`,
      'Content-Transfer-Encoding: base64',
      'Content-ID: <nexusflow-logo>',
      'X-Attachment-Id: nexusflow-logo',
      `Content-Disposition: inline; filename="${logo.fileName}"`,
      '',
      logoDataWrapped,
      '',
      `--${relatedBoundary}--`,
    ].join('\r\n');
  }

  private wrapBase64(value: string): string {
    return (
      value
        .replace(/\s+/g, '')
        .match(/.{1,76}/g)
        ?.join('\r\n') ?? ''
    );
  }

  private inferImageMimeType(filePath: string): string {
    const extension = extname(filePath).toLowerCase();
    const byExt: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
    };

    return byExt[extension] ?? 'image/png';
  }

  private inferFileNameFromMime(mimeType: string): string {
    const byMime: Record<string, string> = {
      'image/png': 'nexusflow-logo.png',
      'image/jpeg': 'nexusflow-logo.jpg',
      'image/gif': 'nexusflow-logo.gif',
      'image/webp': 'nexusflow-logo.webp',
      'image/svg+xml': 'nexusflow-logo.svg',
    };
    return byMime[mimeType.toLowerCase()] ?? 'nexusflow-logo.png';
  }

  private async loadInlineLogo(): Promise<InlineLogo | null> {
    const base64FromEnv = this.configService
      .get<string>('SMTP_EMAIL_LOGO_BASE64')
      ?.trim();
    const logoPath = this.configService
      .get<string>('SMTP_EMAIL_LOGO_PATH')
      ?.trim();
    const mimeTypeFromEnv = this.configService
      .get<string>('SMTP_EMAIL_LOGO_MIME_TYPE')
      ?.trim();
    const fileNameFromEnv = this.configService
      .get<string>('SMTP_EMAIL_LOGO_FILENAME')
      ?.trim();

    if (base64FromEnv) {
      const resolvedMimeType = mimeTypeFromEnv || 'image/png';
      return {
        contentBase64: base64FromEnv,
        mimeType: resolvedMimeType,
        fileName:
          fileNameFromEnv || this.inferFileNameFromMime(resolvedMimeType),
      };
    }

    if (!logoPath) {
      return null;
    }

    try {
      const resolvedPath = resolve(process.cwd(), logoPath);
      const file = await readFile(resolvedPath);
      const resolvedMimeType =
        mimeTypeFromEnv || this.inferImageMimeType(resolvedPath);
      const resolvedFileName = fileNameFromEnv || basename(resolvedPath);
      this.logger.log(`SMTP inline logo loaded from "${resolvedPath}"`);
      return {
        contentBase64: file.toString('base64'),
        mimeType: resolvedMimeType,
        fileName: resolvedFileName,
      };
    } catch {
      this.logger.warn(
        `Failed to load SMTP inline logo from path "${logoPath}". Email will be sent without logo.`
      );
      return null;
    }
  }

  private connect(
    host: string,
    port: number,
    secure: boolean
  ): Promise<MailSocket> {
    return new Promise((resolve, reject) => {
      if (secure) {
        const socket = connectTls(
          { host, port, rejectUnauthorized: false },
          () => resolve(socket)
        );
        socket.once('error', reject);
        return;
      }

      const socket = new Socket();
      socket.connect(port, host);
      socket.once('error', reject);
      socket.once('connect', () => resolve(socket));
    });
  }

  private sendCommand(socket: MailSocket, command: string): Promise<string> {
    socket.write(`${command}\r\n`);
    return this.readResponse(socket);
  }

  private sendData(socket: MailSocket, data: string): Promise<string> {
    const escaped = data
      .split('\r\n')
      .map((line) => (line.startsWith('.') ? `.${line}` : line))
      .join('\r\n');
    socket.write(`${escaped}\r\n.\r\n`);
    return this.readResponse(socket);
  }

  private readResponse(socket: MailSocket): Promise<string> {
    return new Promise((resolve, reject) => {
      let raw = '';
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('SMTP server timeout'));
      }, 10000);

      const onData = (chunk: Buffer | string) => {
        raw += chunk.toString();
        const lines = raw.split('\r\n').filter(Boolean);
        const lastLine = lines[lines.length - 1];
        if (!lastLine || !/^\d{3} /.test(lastLine)) return;

        const code = Number(lastLine.slice(0, 3));
        cleanup();
        if (code >= 400) {
          reject(new Error(`SMTP error response: ${lastLine}`));
          return;
        }
        resolve(raw);
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('data', onData);
        socket.off('error', onError);
      };

      socket.on('data', onData);
      socket.once('error', onError);
    });
  }
}
