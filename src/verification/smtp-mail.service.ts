import { Injectable, Logger } from '@nestjs/common';
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
    expiresInMinutes = 3,
  ): Promise<void> {
    const host = this.configService.get<string>('SMTP_HOST');
    const fromEmail =
      this.configService.get<string>('SMTP_FROM_EMAIL') ??
      this.configService.get<string>('SMTP_USER');
    const port = Number(this.configService.get<string>('SMTP_PORT') ?? 465);
    const username = this.configService.get<string>('SMTP_USER');
    const password = this.configService.get<string>('SMTP_PASS');
    const secure = (this.configService.get<string>('SMTP_SECURE') ?? 'true')
      .toLowerCase()
      .trim() !== 'false';

    if (!host || !fromEmail) {
      this.logger.warn(
        `SMTP is not fully configured. OTP for ${toEmail} is ${otp} (fallback log mode).`,
      );
      return;
    }

    const subject = 'Your NexusFlow email verification code';
    const textBody = [
      'Your NexusFlow verification code is:',
      otp,
      '',
      `It will expire in ${expiresInMinutes} minutes.`,
      'If you did not request this, you can ignore this email.',
    ].join('\r\n');

    const logo = await this.loadInlineLogo();
    const htmlBody = this.buildHtmlBody(otp, Boolean(logo), expiresInMinutes);
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
          Buffer.from(username, 'utf8').toString('base64'),
        );
        await this.sendCommand(
          socket,
          Buffer.from(password, 'utf8').toString('base64'),
        );
      }

      await this.sendCommand(socket, `MAIL FROM:<${fromEmail}>`);
      await this.sendCommand(socket, `RCPT TO:<${toEmail}>`);
      await this.sendCommand(socket, 'DATA');
      await this.sendData(socket, data);
      await this.sendCommand(socket, 'QUIT');
    } finally {
      socket.end();
    }
  }

  private buildHtmlBody(
    otp: string,
    includeLogo: boolean,
    expiresInMinutes: number,
  ): string {
    const logoSection = includeLogo
      ? [
          '<div style="text-align:center;margin-bottom:20px;">',
          '<img src="cid:nexusflow-logo" alt="NexusFlow" style="display:inline-block;max-width:600px;width:100%;height:auto;border:0;" />',
          '</div>',
        ].join('')
      : '';

    return [
      '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;">',
      logoSection,
      '<p>Your NexusFlow verification code is:</p>',
      `<p style="font-size:24px;font-weight:700;letter-spacing:2px;margin:8px 0;">${otp}</p>`,
      `<p>It will expire in ${expiresInMinutes} minutes.</p>`,
      '<p>If you did not request this, you can ignore this email.</p>',
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
    return value.replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') ?? '';
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
    const logoPath = this.configService.get<string>('SMTP_EMAIL_LOGO_PATH')?.trim();
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
        fileName: fileNameFromEnv || this.inferFileNameFromMime(resolvedMimeType),
      };
    }

    if (!logoPath) {
      return null;
    }

    try {
      const resolvedPath = resolve(process.cwd(), logoPath);
      const file = await readFile(resolvedPath);
      const resolvedMimeType = mimeTypeFromEnv || this.inferImageMimeType(resolvedPath);
      const resolvedFileName = fileNameFromEnv || basename(resolvedPath);
      this.logger.log(`SMTP inline logo loaded from "${resolvedPath}"`);
      return {
        contentBase64: file.toString('base64'),
        mimeType: resolvedMimeType,
        fileName: resolvedFileName,
      };
    } catch {
      this.logger.warn(
        `Failed to load SMTP inline logo from path "${logoPath}". Email will be sent without logo.`,
      );
      return null;
    }
  }

  private connect(
    host: string,
    port: number,
    secure: boolean,
  ): Promise<MailSocket> {
    return new Promise((resolve, reject) => {
      if (secure) {
        const socket = connectTls(
          { host, port, rejectUnauthorized: false },
          () => resolve(socket),
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
