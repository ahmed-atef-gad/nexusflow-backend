jest.mock('./flow-builder.service', () => ({
  FlowBuilderService: class FlowBuilderService {},
}));
jest.mock('./setup.service', () => ({ SetupService: class SetupService {} }));
jest.mock('./ui.service', () => ({ UiService: class UiService {} }));
jest.mock('./logic.service', () => ({ LogicService: class LogicService {} }));
jest.mock('src/mqtt/mqtt.service', () => ({
  MqttService: class MqttService {},
}));
jest.mock('src/devices/devices.service', () => ({
  DevicesService: class DevicesService {},
}));
jest.mock('src/notifications/notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));

import { FlowsService } from './flows.service';

describe('FlowsService', () => {
  function buildService(options?: {
    save?: jest.Mock;
    notificationsService?: {
      createDefaultNotificationPreference: jest.Mock;
      syncRulesForFlowNodes: jest.Mock;
    };
  }) {
    const savedFlow = {
      id: 'flow-1',
      toObject: jest.fn(() => ({
        id: 'flow-1',
        name: 'Watering flow',
        userId: 'user-1',
        nodes: [],
        edges: [],
      })),
    };

    const flowDocument: Record<string, unknown> = {
      id: 'flow-1',
      set: jest.fn((path: string, value: unknown) => {
        flowDocument[path] = value;
      }),
      save: options?.save ?? jest.fn().mockResolvedValue(savedFlow),
    };

    const flowModel = jest.fn().mockImplementation((flow) => {
      Object.assign(flowDocument, flow);
      return flowDocument;
    });

    const flowBuilderService = {
      validateFlowStructure: jest.fn(),
      buildSetupFromNodes: jest.fn(() => ({ setup: [], tasks: [] })),
      buildLogicCommandsFromGraph: jest.fn(() => ({ flows: [], warnings: [] })),
      buildUiFromNodes: jest.fn(() => []),
    };
    const setupService = { create: jest.fn() };
    const uiService = { create: jest.fn().mockResolvedValue(null) };
    const logicService = { create: jest.fn() };
    const mqttService = {};
    const devicesService = {};
    const notificationsService = options?.notificationsService ?? {
      createDefaultNotificationPreference: jest.fn(),
      syncRulesForFlowNodes: jest.fn(),
    };

    const service = new FlowsService(
      flowModel as never,
      flowBuilderService as never,
      setupService as never,
      uiService as never,
      logicService as never,
      mqttService as never,
      devicesService as never,
      notificationsService as never
    );

    return {
      service,
      flowModel,
      flowDocument,
      setupService,
      notificationsService,
    };
  }

  it('creates an enabled default notification preference after saving a new flow', async () => {
    const { service, flowDocument, setupService, notificationsService } =
      buildService();

    await service.create(
      {
        name: 'Watering flow',
        nodes: [],
        edges: [],
      } as never,
      'user-1'
    );

    expect(
      notificationsService.createDefaultNotificationPreference
    ).toHaveBeenCalledWith('user-1', 'flow-1');
    expect(
      (flowDocument.save as jest.Mock).mock.invocationCallOrder[0]
    ).toBeLessThan(
      notificationsService.createDefaultNotificationPreference.mock
        .invocationCallOrder[0]
    );
    expect(
      notificationsService.createDefaultNotificationPreference.mock
        .invocationCallOrder[0]
    ).toBeLessThan(setupService.create.mock.invocationCallOrder[0]);
  });
});
