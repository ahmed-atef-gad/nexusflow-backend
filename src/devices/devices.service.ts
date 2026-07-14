import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  forwardRef,
  Inject,
  HttpException,
  HttpStatus,
  Logger,
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
import {
  DeviceRegistrationCode,
  DeviceRegistrationCodeDocument,
} from './schemas/device-registration-code.schema';
import { UsersService } from 'src/users/users.service';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { MQTT_TOPICS } from '../mqtt/mqtt.constants';

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(DeviceToken.name)
    private tokenModel: Model<DeviceTokenDocument>,
    @InjectModel(DeviceAudit.name)
    private auditModel: Model<DeviceAuditDocument>,
    @InjectModel(DeviceRegistrationCode.name)
    private registrationCodeModel: Model<DeviceRegistrationCodeDocument>,
    private readonly mqttService: MqttService,
    @Inject(forwardRef(() => FlowsService))
    private readonly flowsService: FlowsService,
    private readonly usersService: UsersService
  ) {}

  private normalizeMacAddress(macAddress: string): string {
    return macAddress.trim().toUpperCase();
  }

  private generateRegistrationCode(): string {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
  }

  async createRegistrationCode(userId: string, expiresInMinutes = 10) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid User ID');
    }

    await this.registrationCodeModel.updateMany(
      {
        ownerId: new Types.ObjectId(userId),
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { consumedAt: new Date() } }
    );

    for (let i = 0; i < 5; i++) {
      const code = this.generateRegistrationCode();
      const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

      const existingActiveCode = await this.registrationCodeModel.findOne({
        code,
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      });

      if (existingActiveCode) {
        continue;
      }

      await this.registrationCodeModel.create({
        code,
        ownerId: new Types.ObjectId(userId),
        expiresAt,
      });

      return {
        code,
        expiresAt,
        expiresInMinutes,
      };
    }

    throw new BadRequestException('Failed to generate registration code');
  }

  async registerDeviceWithCode(
    code: string,
    macAddress: string,
    name?: string,
    mqttPass?: string
  ) {
    const normalizedCode = code.trim().toUpperCase();

    const registrationCode = await this.registrationCodeModel
      .findOne({
        code: normalizedCode,
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 });

    if (!registrationCode) {
      throw new UnauthorizedException('Invalid or expired registration code');
    }

    const registrationOwnerAuthState = await this.usersService.getAuthStateById(
      registrationCode.ownerId.toString()
    );
    if (registrationOwnerAuthState === null) {
      throw new UnauthorizedException('Invalid or expired registration code');
    }
    if (!registrationOwnerAuthState.emailVerified) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PRECONDITION_REQUIRED,
          error: 'Precondition Required',
          message: 'Email is not verified. Please verify your email first.',
          code: 'EMAIL_NOT_VERIFIED',
        },
        HttpStatus.PRECONDITION_REQUIRED
      );
    }

    const normalizedMac = this.normalizeMacAddress(macAddress);
    const existingDevice = await this.deviceModel.findOne({
      macAddress: normalizedMac,
    });

    let device: DeviceDocument;

    if (existingDevice) {
      if (
        existingDevice.ownerId.toString() ===
        registrationCode.ownerId.toString()
      ) {
        existingDevice.name = name || existingDevice.name;
        existingDevice.mqtt_pass = mqttPass || existingDevice.mqtt_pass;
        await existingDevice.save();
        device = existingDevice;
      } else {
        throw new BadRequestException(
          'Device with this MAC address already registered to another user'
        );
      }
    } else {
      device = await this.registerDevice(
        registrationCode.ownerId.toString(),
        macAddress,
        name,
        mqttPass
      );
    }

    await this.registrationCodeModel.updateOne(
      { _id: registrationCode._id },
      { $set: { consumedAt: new Date() } }
    );
    //generate access token for the device
    const token = await this.generateDeviceToken(device._id.toString());

    const deviceObject = device.toObject() as unknown as Record<
      string,
      unknown
    >;
    return { ...deviceObject, token };
  }

  // Register a new device
  async registerDevice(
    userId: string,
    macAddress: string,
    name?: string,
    mqttPass?: string
  ): Promise<DeviceDocument> {
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
  async authenticateByMacAndPassword(
    macAddress: string,
    mqttPass: string
  ): Promise<DeviceDocument | null> {
    const normalizedMac = this.normalizeMacAddress(macAddress);

    const device = await this.deviceModel
      .findOne({ macAddress: normalizedMac })
      .select('+mqtt_pass');
    if (!device || !device.mqtt_pass) return null;

    const isMatch = await bcrypt.compare(mqttPass, device.mqtt_pass);
    if (!isMatch) return null;

    return device;
  }

  async findByMacAddress(macAddress: string): Promise<DeviceDocument> {
    const normalizedMac = this.normalizeMacAddress(macAddress);
    const device = await this.deviceModel
      .findOne({ macAddress: normalizedMac })
      .exec();

    if (!device) {
      throw new NotFoundException(
        `Device with MAC address ${normalizedMac} not found`
      );
    }

    return device;
  }

  // Generate a token for device authentication (format: tokenId.secret)
  async generateDeviceToken(deviceId: string): Promise<{
    accessToken: string;
    deviceId: string;
    macAddress: string;
  }> {
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
      deviceId: device._id.toString(),
      scopes: ['flow:read', 'setup:read'],
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    });

    // Return token (only returned once)
    return {
      accessToken: fullToken,
      deviceId: device._id.toString(),
      macAddress: device.macAddress,
    };
  }

  // Validate device token
  async validateToken(fullToken: string): Promise<DeviceDocument | null> {
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
    return this.deviceModel.findById(tokenDoc.deviceId).exec();
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

  async updateLastActiveByMacAddress(macAddress: string) {
    const normalizedMac = this.normalizeMacAddress(macAddress);
    await this.deviceModel.updateOne(
      { macAddress: normalizedMac },
      { lastActiveAt: new Date() }
    );
  }

  async updateDeviceFlow(deviceId: string, flowId: string, userId: string) {
    let ownerId: string;
    try {
      ownerId = await this.flowsService.findFlowOwnerId(flowId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(`Flow with ID ${flowId} not found`);
      }
      throw error;
    }

    // Verify that the flow belongs to the same user who owns the device
    if (ownerId !== userId) {
      throw new UnauthorizedException(
        'Cannot link device to a flow owned by another user'
      );
    }

    const flowObjectId = new Types.ObjectId(flowId);
    const deviceObjectId = new Types.ObjectId(deviceId);
    const userObjectId = new Types.ObjectId(userId);

    // Ensure the flow is linked to only one device by unlinking others
    await this.deviceModel.updateMany(
      {
        ownerId: userObjectId,
        activeFlowId: flowObjectId,
        _id: { $ne: deviceObjectId },
      },
      { $unset: { activeFlowId: 1 } }
    );

    const updatedDevice = await this.deviceModel
      .findByIdAndUpdate(
        deviceObjectId,
        { activeFlowId: flowObjectId },
        { new: true }
      )
      .exec();

    if (!updatedDevice) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    await this.flowsService.rebuildUiForFlow(flowId);

    await this.mqttService.publishDeviceFlowChanged(
      updatedDevice.macAddress,
      flowId,
      updatedDevice.updatedAt ?? new Date()
    );

    return updatedDevice;
  }

  async unlinkDeviceFlow(deviceId: string, userId: string) {
    const device = await this.findOne(deviceId);

    if (device.ownerId.toString() !== userId) {
      throw new UnauthorizedException(
        'Cannot unlink a device owned by another user'
      );
    }

    if (!device.activeFlowId) {
      return device;
    }

    const updatedDevice = await this.deviceModel
      .findByIdAndUpdate(
        device._id,
        { $unset: { activeFlowId: 1 } },
        { new: true }
      )
      .exec();

    if (!updatedDevice) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    await this.mqttService.publishDeviceFlowChanged(
      updatedDevice.macAddress,
      null,
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
    const connectedAt = this.mqttService.getClientConnectedAt(normalizedMac);
    const lastSeen = device.lastActiveAt
      ? device.lastActiveAt
      : device.createdAt;
    const status = isOnline ? 'online' : 'offline';

    return {
      deviceId,
      connectedAt,
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
  async findAllByUserIdRaw(userId: string): Promise<DeviceDocument[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid User ID');
    }

    return this.deviceModel
      .find({ ownerId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  async findAllByUserId(
    userId: string,
    query: PaginationQueryDto
  ): Promise<{
    data: DeviceDocument[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid User ID');
    }

    const parsedPage = Number(query.page);
    const parsedLimit = Number(query.limit);

    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 10;

    const filter: Record<string, unknown> = {
      ownerId: new Types.ObjectId(userId),
    };

    if (query.search?.trim()) {
      const escaped = query.search
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchRegex = new RegExp(escaped, 'i');
      filter.name = searchRegex;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.deviceModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.deviceModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: total > 0 ? Math.ceil(total / limit) : 1,
    };
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
    const deletedDevice = await this.deviceModel.findByIdAndDelete(deviceId);

    if (
      deletedDevice &&
      this.mqttService.isClientConnected(deletedDevice.macAddress)
    ) {
      try {
        await this.mqttService.publishMessage(
          MQTT_TOPICS.RESET_WIFI(deletedDevice.macAddress),
          'Device deleted. Reset WiFi credentials and disconnect.'
        );
      } catch (error) {
        this.logger.warn(
          `Failed to publish reset WiFi message for deleted device ${deletedDevice.macAddress}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}
