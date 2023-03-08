import ChargingStationStorage from '../../storage/mongodb/ChargingStationStorage';
import Constants from '../../utils/Constants';
import { LockEntity } from '../../types/Locking';
import LockingManager from '../../locking/LockingManager';
import Logging from '../../utils/Logging';
import LoggingHelper from '../../utils/LoggingHelper';
import OCPPUtils from '../../server/ocpp/utils/OCPPUtils';
import { ServerAction } from '../../types/Server';
import Tenant from '../../types/Tenant';
import TenantSchedulerTask from '../TenantSchedulerTask';
import Utils from '../../utils/Utils';

const MODULE_NAME = 'CheckChargingStationTemplateTask';

export default class CheckChargingStationTemplateTask extends TenantSchedulerTask {
  public async processTenant(tenant: Tenant): Promise<void> {
    // Get the lock
    const checkChargingStationTemplateLock = LockingManager.createExclusiveLock(tenant.id, LockEntity.CHARGING_STATION, 'check-charging-station-template');
    if (await LockingManager.acquire(checkChargingStationTemplateLock)) {
      try {
        // Update
        await this.applyTemplateToChargingStations(tenant);
      } catch (error) {
        // Log error
        Logging.logActionExceptionMessage(tenant.id, ServerAction.UPDATE_CHARGING_STATION_WITH_TEMPLATE, error);
      } finally {
        // Release the lock
        await LockingManager.release(checkChargingStationTemplateLock);
      }
    }
  }

  private async applyTemplateToChargingStations(tenant: Tenant) {
    let updated = 0;
    // Prepare pagination
    const limit = Constants.BATCH_PAGE_SIZE; // Avoid loading too much data in one shot
    const sort = null; // No sort
    let skip = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Get the charging stations
      const chargingStations = await ChargingStationStorage.getChargingStations(tenant, {
        issuer: true,
        manualConfiguration: false, // template cannot be applied when a manual configuration is being used
        // withSiteArea: true, // Site area data is loaded only when necessary
      }, {
        limit, skip, sort
      });
      if (Utils.isEmptyArray(chargingStations.result)) {
        break;
      }
      // Increment skip for next round
      skip += limit;
      // Update
      for (const chargingStation of chargingStations.result) {
        try {
          // Apply template
          const chargingStationTemplateUpdateResult = await OCPPUtils.checkAndApplyTemplateToChargingStation(tenant, chargingStation);
          // Save
          if (chargingStationTemplateUpdateResult.chargingStationUpdated) {
            await ChargingStationStorage.saveChargingStation(tenant, chargingStation);
            updated++;
          }
        } catch (error) {
          Logging.beError()?.log({
            ...LoggingHelper.getChargingStationProperties(chargingStation),
            tenantID: tenant.id,
            action: ServerAction.UPDATE_CHARGING_STATION_WITH_TEMPLATE,
            module: MODULE_NAME, method: 'applyTemplateToChargingStations',
            message: `Template update error in Tenant ${Utils.buildTenantName(tenant)}): ${error.message as string}`,
            detailedMessages: { error: error.stack }
          });
        }
      }
    }
    if (updated > 0) {
      Logging.beDebug()?.log({
        tenantID: tenant.id,
        action: ServerAction.UPDATE_CHARGING_STATION_WITH_TEMPLATE,
        module: MODULE_NAME, method: 'applyTemplateToChargingStations',
        message: `${updated} Charging Stations have been processed with Template in Tenant ${Utils.buildTenantName(tenant)})`
      });
    }
  }
}

