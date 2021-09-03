/* eslint-disable max-len */
import FeatureToggles, { Feature } from '../../../utils/FeatureToggles';
import PricingDefinition, { PricedConsumption, PricingSource, ResolvedPricingModel } from '../../../types/Pricing';

import ChargingStation from '../../../types/ChargingStation';
import Consumption from '../../../types/Consumption';
import PricingEngine from '../PricingEngine';
import PricingIntegration from '../PricingIntegration';
import { SimplePricingSetting } from '../../../types/Setting';
import Tenant from '../../../types/Tenant';
import Transaction from '../../../types/Transaction';
import Utils from '../../../utils/Utils';

// --------------------------------------------------------------------------------------------------
// TODO - POC - BuiltInPricingIntegration is hidden behind a feature toggle
// This concrete implementation of the PricingIntegration still relies on the SimplePricingSettings
// --------------------------------------------------------------------------------------------------
export default class BuiltInPricingIntegration extends PricingIntegration<SimplePricingSetting> {
  constructor(tenant: Tenant, readonly settings: SimplePricingSetting) {
    super(tenant, settings);
  }

  public async startSession(transaction: Transaction, consumptionData: Consumption, chargingStation: ChargingStation): Promise<PricedConsumption> {
    return this.computePrice(transaction, consumptionData, chargingStation);
  }

  public async updateSession(transaction: Transaction, consumptionData: Consumption, chargingStation: ChargingStation): Promise<PricedConsumption> {
    return this.computePrice(transaction, consumptionData, chargingStation);
  }

  public async stopSession(transaction: Transaction, consumptionData: Consumption, chargingStation: ChargingStation): Promise<PricedConsumption> {
    return this.computePrice(transaction, consumptionData, chargingStation);
  }

  private async computePrice(transaction: Transaction, consumptionData: Consumption, chargingStation: ChargingStation): Promise<PricedConsumption> {
    let pricingModel = transaction.pricingModel;
    if (!pricingModel) {
      // This should happen only on the first call (i.e.: on a start transaction)
      pricingModel = await this.resolvePricingContext(this.tenant, transaction, chargingStation);
    }
    const pricingConsumptionData = PricingEngine.priceConsumption(this.tenant, pricingModel, consumptionData);
    const { flatFee, energy, chargingTime, parkingTime } = pricingConsumptionData;
    const amount = Utils.createDecimal(flatFee?.amount || 0).plus(energy?.amount || 0).plus(chargingTime?.amount || 0).plus(parkingTime?.amount || 0).toNumber();
    const roundedAmount = Utils.createDecimal(flatFee?.roundedAmount || 0).plus(energy?.roundedAmount || 0).plus(chargingTime?.roundedAmount || 0).plus(parkingTime?.roundedAmount || 0).toNumber();
    // Sum all dimensions
    const pricedConsumption: PricedConsumption = {
      pricingSource: PricingSource.SIMPLE,
      pricingModel,
      amount: amount,
      roundedAmount: roundedAmount,
      currencyCode: this.settings.currency,
      cumulatedAmount: transaction.currentCumulatedPrice ? Utils.createDecimal(transaction.currentCumulatedPrice).plus(amount).toNumber() : amount
    };
    return Promise.resolve(pricedConsumption);
  }

  private async resolvePricingContext(tenant: Tenant, transaction: Transaction, chargingStation: ChargingStation): Promise<ResolvedPricingModel> {
    const resolvedPricingModel: ResolvedPricingModel = await PricingEngine.resolvePricingContext(tenant, transaction, chargingStation);
    if (!resolvedPricingModel.pricingDefinitions?.length) {
      resolvedPricingModel.pricingDefinitions = [ this.getDefaultPricingDefinition() ];
    }
    return resolvedPricingModel;
  }

  private getDefaultPricingDefinition(): PricingDefinition {
    if (FeatureToggles.isFeatureActive(Feature.PRICING_TEST_ENERGY_WITH_STEP_SIZE)) {
      // TODO - Should be removed - just for testing purposes!
      return {
        name: 'Tariff Energy StepSize',
        description: 'Tariff - E + SZ',
        dimensions: {
          flatFee: {
            active: true,
            price: 3, // per session
          },
          energy: {
            active: true,
            price: 0.3, // per kWh
            stepSize: 10 // kWh
          },
        }
      } as PricingDefinition;
    }
    if (FeatureToggles.isFeatureActive(Feature.PRICING_TEST_PARKING_TIME)) {
      // TODO - Should be removed - just for testing purposes!
      return {
        name: 'Tariff 3 Dimensions',
        description: 'Tariff - FF + CT + PT',
        dimensions: {
          flatFee: {
            active: true,
            price: 3, // per session
          },
          chargingTime: {
            active: true,
            price: 120, // per hour
            stepSize: 60, // seconds
          },
          parkingTime: {
            active: true,
            price: 7, // per hour
          },
        }
      } as PricingDefinition;
    }
    // Defaults to the simple pricing settings
    return {
      name: 'Default Tariff',
      description: 'Tariff based on simple pricing settings',
      dimensions: {
        energy: {
          active: true,
          price: this.setting.price,
        }
      }
    } as PricingDefinition;
  }

}
