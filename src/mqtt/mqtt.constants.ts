export const MQTT_TOPICS = {
  FLOW_LAST_UPDATE: (macAddress: string) =>
    `/devices/${macAddress}/flowupdated`,
  DEVICE_FLOW_CHANGED: (macAddress: string) =>
    `/devices/${macAddress}/flowchanged`,
  RESET_WIFI: (macAddress: string) => `esp/${macAddress}/resetwifi`,
};
