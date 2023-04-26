import { OCPPProtocol, OCPPVersion } from '../../../../types/ocpp/OCPPServer';

import BackendError from '../../../../exception/BackendError';
import ChargingStationClient from '../../../../client/ocpp/ChargingStationClient';
import ChargingStationStorage from '../../../../storage/mongodb/ChargingStationStorage';
import { Command } from '../../../../types/ChargingStation';
import Configuration from '../../../../utils/Configuration';
import Constants from '../../../../utils/Constants';
import JsonChargingStationClient from '../../../../client/ocpp/json/JsonChargingStationClient';
import JsonChargingStationService from '../services/JsonChargingStationService';
import Logging from '../../../../utils/Logging';
import LoggingHelper from '../../../../utils/LoggingHelper';
import OCPPError from '../../../../exception/OcppError';
import { OCPPErrorType } from '../../../../types/ocpp/OCPPCommon';
import { OCPPHeader } from '../../../../types/ocpp/OCPPHeader';
import OCPPUtils from '../../utils/OCPPUtils';
import { PerformanceRecordGroup } from '../../../../types/Performance';
import { ServerAction } from '../../../../types/Server';
import Utils from '../../../../utils/Utils';
import WSConnection from './WSConnection';
import WSWrapper from './WSWrapper';

const MODULE_NAME = 'JsonWSConnection';

export default class JsonWSConnection extends WSConnection {
  private chargingStationClient: JsonChargingStationClient;
  private chargingStationService: JsonChargingStationService;

  public constructor(ws: WSWrapper) {
    super(ws);
  }

  public async initialize(): Promise<void> {
    // Init parent
    await super.initialize();
    if (Utils.isMonitoringEnabled()) {
      const labelValues = { tenant: this.getTenant().subdomain };
      this.getWS().ocppOpenWebSocketMetricCounter = global.monitoringServer.getCounterClearableMetric(PerformanceRecordGroup.OCPP, 'OpenedWebSocket', 'Opened web sockets', labelValues);
      this.getWS().ocppClosedWebSocketMetricCounter = global.monitoringServer.getCounterClearableMetric(PerformanceRecordGroup.OCPP, 'ClosedWebSocket', 'Closed web sockets', labelValues);
    }
    // Create the Json Client
    this.chargingStationClient = new JsonChargingStationClient(this);
    // Create the Json Server Service
    this.chargingStationService = new JsonChargingStationService();
  }

  public async handleRequest(command: Command, commandPayload: Record<string, unknown> | string): Promise<any> {
    let result: any;
    // Check Command
    if (!this.isValidOcppServerCommand(command)) {
      throw new BackendError({
        chargingStationID: this.getChargingStationID(),
        siteID: this.getSiteID(),
        siteAreaID: this.getSiteAreaID(),
        companyID: this.getCompanyID(),
        module: MODULE_NAME,
        method: 'handleRequest',
        message: `Command '${command}' is not allowed from Charging Station`,
        action: OCPPUtils.buildServerActionFromOcppCommand(command)
      });
    }
    // Set
    const methodName = `handle${command}`;
    // Check if method exist in the service
    if (typeof this.chargingStationService[methodName] === 'function') {
    // Initialize the default Headers
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const headers: OCPPHeader = {
        chargeBoxIdentity: this.getChargingStationID(),
        ocppVersion: (this.getWS().protocol.startsWith('ocpp') ? this.getWS().protocol.replace('ocpp', '') : this.getWS().protocol) as OCPPVersion,
        ocppProtocol: OCPPProtocol.JSON,
        chargingStationURL: Configuration.getJsonEndpointConfig().baseSecureUrl,
        tenantID: this.getTenantID(),
        tokenID: this.getTokenID(),
        From: {
          Address: this.getClientIP()
        }
      };
      headers.currentIPAddress = this.getClientIP();
      // Set the header
      headers.connectionContext = await OCPPUtils.checkAndGetChargingStationConnectionData(
        OCPPUtils.buildServerActionFromOcppCommand(command), this.rawConnectionData);
      // Trace
      const performanceTracingData = await Logging.traceOcppMessageRequest(Constants.MODULE_JSON_OCPP_SERVER_16,
        this.getTenant(), this.getChargingStationID(), OCPPUtils.buildServerActionFromOcppCommand(command), commandPayload, '>>',
        { siteAreaID: this.getSiteAreaID(), siteID: this.getSiteID(), companyID: this.getCompanyID() }
      );
      try {
        // Call it
        result = await this.chargingStationService[methodName](headers, commandPayload);
      } finally {
        // Trace
        await Logging.traceOcppMessageResponse(Constants.MODULE_JSON_OCPP_SERVER_16, this.getTenant(), this.getChargingStationID(),
          OCPPUtils.buildServerActionFromOcppCommand(command), commandPayload, result, '<<',
          { siteAreaID: this.getSiteAreaID(), siteID: this.getSiteID(), companyID: this.getCompanyID() }, performanceTracingData
        );
      }
    } else {
      // Throw Exception
      throw new OCPPError({
        ...LoggingHelper.getWSConnectionProperties(this),
        module: MODULE_NAME,
        method: 'handleRequest',
        code: OCPPErrorType.NOT_IMPLEMENTED,
        message: (typeof command === 'string') ? `OCPP method 'handle${command}()' has not been implemented` : `Unknown OCPP command: ${JSON.stringify(command)}`
      });
    }
    return result;
  }

  public getChargingStationClient(): ChargingStationClient {
    return this.chargingStationClient;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public onPing(message: string): void {
    // this.updateChargingStationLastSeen().catch(() => { /* Intentional */ });
    Logging.beDebug()?.log({
      ...LoggingHelper.getWSConnectionProperties(this),
      tenantID: this.getTenantID(),
      action: ServerAction.WS_CLIENT_CONNECTION_PING,
      module: MODULE_NAME, method: 'onPing',
      message: 'Ping received'
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public onPong(message: string): void {
    // this.updateChargingStationLastSeen().catch(() => { /* Intentional */ });
    Logging.beDebug()?.log({
      ...LoggingHelper.getWSConnectionProperties(this),
      tenantID: this.getTenantID(),
      action: ServerAction.WS_CLIENT_CONNECTION_PONG,
      module: MODULE_NAME, method: 'onPong',
      message: 'Pong received'
    });
  }

  public async updateChargingStationRuntimeData() {
    // Update Charging Station info
    const chargingStation = this.getChargingStation();
    // First time the charging station connects, it does not yet exist
    if (chargingStation) {
      chargingStation.lastSeen = new Date();
      chargingStation.tokenID = this.getTokenID();
      chargingStation.cloudHostIP = Utils.getHostIP();
      chargingStation.cloudHostName = Utils.getHostName();
      // Save Charging Station runtime data
      await ChargingStationStorage.saveChargingStationRuntimeData(this.getTenant(), chargingStation.id, {
        lastSeen: chargingStation.lastSeen,
        tokenID: chargingStation.tokenID,
        cloudHostIP: chargingStation.cloudHostIP,
        cloudHostName: chargingStation.cloudHostName,
      });
    }
  }

  // private async updateChargingStationLastSeen(): Promise<void> {
  //   // Update once every ping interval / 2
  //   if (!this.lastSeen ||
  //     (Date.now() - this.lastSeen.getTime()) > (Configuration.getChargingStationConfig().pingIntervalOCPPJSecs * 1000 / 2)) {
  //     // Update last seen
  //     this.lastSeen = new Date();
  //     if (FeatureToggles.isFeatureActive(Feature.OCPP_OPTIMIZE_LAST_SEEN_UPDATE)) {
  //       await ChargingStationStorage.saveChargingStationRuntimeData(this.getTenant(), this.getChargingStationID(),
  //         { lastSeen: this.lastSeen });
  //     } else {
  //       const chargingStation = await ChargingStationStorage.getChargingStation(this.getTenant(),
  //         this.getChargingStationID(), { issuer: true }, ['id']);
  //       if (chargingStation) {
  //         await ChargingStationStorage.saveChargingStationRuntimeData(this.getTenant(), this.getChargingStationID(),
  //           { lastSeen: this.lastSeen });
  //       }
  //     }
  //   }
  // }

  private isValidOcppServerCommand(command: Command): boolean {
    // Only client request is allowed
    return [
      Command.AUTHORIZE,
      Command.BOOT_NOTIFICATION,
      Command.DATA_TRANSFER,
      Command.DIAGNOSTICS_STATUS_NOTIFICATION,
      Command.FIRMWARE_STATUS_NOTIFICATION,
      Command.HEARTBEAT,
      Command.METER_VALUES,
      Command.START_TRANSACTION,
      Command.STATUS_NOTIFICATION,
      Command.STOP_TRANSACTION,
    ].includes(command);
  }
}
