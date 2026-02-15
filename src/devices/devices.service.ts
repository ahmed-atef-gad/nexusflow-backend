import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { Device, DeviceDocument } from './schemas/device.schema';
import { MqttService } from '../mqtt/mqtt.service';
import { FlowsService } from '../flows/flows.service';
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
    private auditModel: Model<DeviceAuditDocument>,
    private readonly mqttService: MqttService,
    @Inject(forwardRef(() => FlowsService))
    private readonly flowsService: FlowsService
  ) {}

  private normalizeMacAddress(macAddress: string): string {
    return macAddress.trim().toUpperCase();
  }

  // Register a new device
  async registerDevice(
    userId: string,
    macAddress: string,
    name?: string,
    mqttPass?: string
  ) {
    // Normalize MAC address
    const normalizedMac = macAddress.trim().toUpperCase();

    // Check if device already exists
    const existingDevice = await this.deviceModel.findOne({
      macAddress: normalizedMac,
    });

    if (existingDevice) {
      // Device already registered to another user
      if (existingDevice.ownerId.toString() !== userId) {
        throw new BadRequestException(
          'Device already registered to another user'
        );
      }
      // Device already registered to this user
      throw new BadRequestException(
        'Device already registered to your account'
      );
    }

    if (!mqttPass) {
      throw new BadRequestException('mqtt_pass is required');
    }

    // Create new device
    const device = new this.deviceModel({
      macAddress: normalizedMac,
      ownerId: new Types.ObjectId(userId),
      name: name || `ESP-${normalizedMac}`,
      mqtt_pass: mqttPass,
    });
    return device.save();
  }

  // Authenticate device over MQTT credentials (mac + password)
  async authenticateByMacAndPassword(macAddress: string, mqttPass: string) {
    const normalizedMac = this.normalizeMacAddress(macAddress);

    const device = await this.deviceModel
      .findOne({ macAddress: normalizedMac })
      .select('+mqtt_pass');
    if (!device || !device.mqtt_pass) return null;

    const isMatch = await bcrypt.compare(mqttPass, device.mqtt_pass);
    if (!isMatch) return null;

    return device;
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

  // Find one device by activeFlowId
  async findByActiveFlowId(activeFlowId: string): Promise<DeviceDocument> {
    if (!Types.ObjectId.isValid(activeFlowId)) {
      throw new BadRequestException('Invalid activeFlowId');
    }

    const device = await this.deviceModel
      .findOne({ activeFlowId: new Types.ObjectId(activeFlowId) })
      .exec();

    if (!device) {
      throw new NotFoundException(
        `Device with activeFlowId ${activeFlowId} not found`
      );
    }

    return device;
  }

  async updateDeviceFlow(deviceId: string, flowId: string ,) {
    // Validate IDs format to distinguish bad input from not-found
    if (!Types.ObjectId.isValid(deviceId)) {
      throw new BadRequestException('Invalid Device ID');
    }
    if (!Types.ObjectId.isValid(flowId)) {
      throw new BadRequestException('Invalid flowId');
    }

    let flow;
    try {
      flow = await this.flowsService.findFlowById(flowId);
    } catch (error) {
      // Let BadRequestException and other unexpected errors propagate
      if (error instanceof NotFoundException) {
        // Normalize flow not-found message
        throw new NotFoundException(`Flow with ID ${flowId} not found`);
      }
      throw error;
    }
    if (!flow) {
      throw new NotFoundException(`Flow with ID ${flowId} not found`);
    }
    
    const updatedDevice = await this.deviceModel.findByIdAndUpdate(
      deviceId,
      { activeFlowId: new Types.ObjectId(flowId) },
      { new: true }
    );

    if (!updatedDevice) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    await this.mqttService.publishDeviceFlowChanged(
      updatedDevice.macAddress,
      flowId,
      updatedDevice.updatedAt ?? new Date()
    );

    return updatedDevice;
  }
  async getDeviceStatus(deviceId: string) {
    const device = await this.deviceModel.findById(deviceId).exec();
    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    const normalizedMac = this.normalizeMacAddress(device.macAddress);
    const isOnline = this.mqttService.isClientConnected(normalizedMac);
    const lastSeen = isOnline ? new Date() : null;
    const status = isOnline ? 'online' : 'offline';

    return {
      deviceId,
      lastSeen,
      status,
    };
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

  // Get all devices for a specific user
  async findAllByUserId(userId: string): Promise<DeviceDocument[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid User ID');
    }

    return this.deviceModel
      .find({ ownerId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  // Delete a device and its associated tokens
  async deleteDevice(deviceId: string): Promise<void> {
    if (!Types.ObjectId.isValid(deviceId)) {
      throw new BadRequestException('Invalid Device ID');
    }

    const device = await this.deviceModel.findById(deviceId);

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    // Delete all tokens associated with this device
    await this.tokenModel.deleteMany({
      deviceId: new Types.ObjectId(deviceId),
    });

    // Delete the device
    await this.deviceModel.findByIdAndDelete(deviceId);
  }
}
