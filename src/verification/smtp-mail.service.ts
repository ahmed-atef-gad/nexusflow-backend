import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Socket } from 'node:net';
import { connect as connectTls, TLSSocket } from 'node:tls';

type MailSocket = Socket | TLSSocket;

@Injectable()
export class SmtpMailService {
  private readonly logger = new Logger(SmtpMailService.name);

  constructor(private readonly configService: ConfigService) { }

  async sendOtpEmail(toEmail: string, otp: string): Promise<void> {
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
      'It will expire in 10 minutes.',
      'If you did not request this, you can ignore this email.',
    ].join('\r\n');

    const htmlBody = [
      `<p style="font-size:24px;font-weight:700;letter-spacing:2px; color:red;">البلبل</p>`,
      '<p>Your NexusFlow verification code is:</p>',
      `<p style="font-size:24px;font-weight:700;letter-spacing:2px;">${otp}</p>`,
      '<p>It will expire in 10 minutes.</p>',
      '<p>If you did not request this, you can ignore this email.</p>',
    ].join('');

    const data = [
      `From: ${fromEmail}`,
      `To: ${toEmail}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="boundary_otp"',
      '',
      '--boundary_otp',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      textBody,
      '',
      '--boundary_otp',
      'Content-Type: text/html; charset="UTF-8"',
      '',
      htmlBody,
      '',
      '--boundary_otp--',
    ].join('\r\n');

    const socket = await this.connect(host, port, secure);
    try {
      await this.readResponse(socket);
      await this.sendCommand(socket, `EHLO nexusflow.local`);

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
