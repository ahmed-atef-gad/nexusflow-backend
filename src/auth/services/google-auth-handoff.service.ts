import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  GoogleAuthHandoff,
  GoogleAuthHandoffDocument,
} from '../schemas/google-auth-handoff.schema';

const DEFAULT_HANDOFF_TTL_SECONDS = 180;

@Injectable()
export class GoogleAuthHandoffService {
  constructor(
    @InjectModel(GoogleAuthHandoff.name)
    private readonly handoffModel: Model<GoogleAuthHandoffDocument>
  ) {}

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }

  private getTtlSeconds(): number {
    const configuredTtl = Number(process.env.GOOGLE_MOBILE_HANDOFF_TTL_SECONDS);
    if (Number.isFinite(configuredTtl) && configuredTtl > 0) {
      return configuredTtl;
    }
    return DEFAULT_HANDOFF_TTL_SECONDS;
  }

  private calculateCodeChallenge(codeVerifier: string): string {
    return createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private timingSafeCompare(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  async create(input: {
    userId: string;
    codeChallenge: string;
  }): Promise<string> {
    const code = randomBytes(32).toString('base64url');
    await this.handoffModel.create({
      codeHash: this.hash(code),
      userId: new Types.ObjectId(input.userId),
      codeChallenge: input.codeChallenge,
      expiresAt: new Date(Date.now() + this.getTtlSeconds() * 1000),
      consumedAt: null,
    });
    return code;
  }

  async consume(input: {
    code: string;
    codeVerifier: string;
  }): Promise<{ userId: string }> {
    const codeHash = this.hash(input.code);
    const existing = await this.handoffModel
      .findOne({ codeHash })
      .select('codeChallenge expiresAt consumedAt userId')
      .lean()
      .exec();

    if (!existing) {
      throw new BadRequestException('google_code_invalid');
    }

    if (existing.consumedAt) {
      throw new BadRequestException('google_code_consumed');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('google_code_expired');
    }

    const suppliedChallenge = this.calculateCodeChallenge(input.codeVerifier);
    if (!this.timingSafeCompare(suppliedChallenge, existing.codeChallenge)) {
      throw new UnauthorizedException('google_pkce_invalid');
    }

    const consumed = await this.handoffModel
      .findOneAndUpdate(
        {
          codeHash,
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { $set: { consumedAt: new Date() } },
        { new: true }
      )
      .select('userId')
      .lean()
      .exec();

    if (!consumed) {
      throw new BadRequestException('google_code_consumed');
    }

    return { userId: String(consumed.userId) };
  }
}
