import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { Device, DeviceDocument } from './schemas/device.schema';
import {
  DeviceToken,
  DeviceTokenDocument,
} from './schemas/device-token.schema';
import {
  DeviceAudit,
  DeviceAuditDocument,
} from './schemas/device-audit.schema';

@Injectable()
export class DevicesService {
  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(DeviceToken.name)
    private tokenModel: Model<DeviceTokenDocument>,
    @InjectModel(DeviceAudit.name)
    private auditModel: Model<DeviceAuditDocument>
  ) {}

  // Register a new device or update existing one
  async registerDevice(userId: string, macAddress: string, name?: string) {
    // Normalize MAC address
    const normalizedMac = macAddress.trim().toUpperCase();

    // Check if device already exists
    let device = await this.deviceModel.findOne({ macAddress: normalizedMac });

    if (device) {
      // Verify the device belongs to this user
      if (device.ownerId.toString() !== userId) {
        throw new BadRequestException(
          'Device already registered to another user'
        );
      }
      // Update device name if provided
      device.name = name || device.name;
      return device.save();
    }

    // Create new device
    device = new this.deviceModel({
      macAddress: normalizedMac,
      ownerId: new Types.ObjectId(userId),
      name: name || `ESP-${normalizedMac}`,
    });
    return device.save();
  }

  // Generate a token for device authentication (format: tokenId.secret)
  async generateDeviceToken(deviceId: string) {
    // Verify device exists
    const device = await this.deviceModel.findById(deviceId);
    if (!device) throw new NotFoundException('Device not found');

    // Generate token components
    const tokenId = uuidv4(); // Public identifier
    const secret = crypto.randomBytes(32).toString('hex'); // Private secret
    const fullToken = `${tokenId}.${secret}`; // Full token for device

    // Hash secret before saving to database
    const salt = await bcrypt.genSalt();
    const tokenHash = await bcrypt.hash(secret, salt);

    // Store token in database
    await this.tokenModel.create({
      tokenId,
      tokenHash,
      deviceId: device._id,
      scopes: ['flow:read', 'setup:read'],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    });

    // Return token (only returned once)
    return {
      accessToken: fullToken,
      deviceId: device._id,
      macAddress: device.macAddress,
    };
  }

  // Validate device token
  async validateToken(fullToken: string) {
    // Parse token
    const [tokenId, secret] = fullToken.split('.');
    if (!tokenId || !secret) return null;

    // Find token (not revoked)
    const tokenDoc = await this.tokenModel.findOne({
      tokenId,
      revokedAt: null,
    });
    if (!tokenDoc) return null;

    // Check if expired
    if (tokenDoc.expiresAt < new Date()) return null;

    // Verify secret matches hash
    const isMatch = await bcrypt.compare(secret, tokenDoc.tokenHash);
    if (!isMatch) return null;

    // Update last used timestamp
    const twoMinutes = 2 * 60 * 1000;
    const lastUsed = tokenDoc.lastUsedAt ? tokenDoc.lastUsedAt.getTime() : 0;
    if (new Date().getTime() - lastUsed > twoMinutes) {
        await this.tokenModel.updateOne(
        { _id: tokenDoc._id },
        { lastUsedAt: new Date() }
        );
  }

    // Return device info
    return this.deviceModel.findById(tokenDoc.deviceId);
  }

  // Revoke a device token
  async revokeToken(tokenId: string) {
    return this.tokenModel.updateOne({ tokenId }, { revokedAt: new Date() });
  }

    // Find device by ID
    async findOne(deviceId: string): Promise<DeviceDocument> {
    // Validate device ID format
    if (!Types.ObjectId.isValid(deviceId)) {
      throw new BadRequestException('Invalid Device ID');
    }

    const device = await this.deviceModel.findById(deviceId).exec();
    
    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    return device;
  }


  // Log device activity for auditing
  async logActivity(data: {
    deviceId: string;
    action: string;
    ip: string;
    statusCode: number;
  }) {
    return this.auditModel.create(data);
  }
}
