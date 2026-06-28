import { Module, Global } from '@nestjs/common';
import { BikeEnergyPlugin } from './plugins/bike-energy.plugin';
import { FastFeetPlugin } from './plugins/fast-feet.plugin';
import { EnergyGeneratorPlugin } from './plugins/energy-generator.plugin';

@Global()
@Module({
  providers: [
    BikeEnergyPlugin,
    FastFeetPlugin,
    EnergyGeneratorPlugin,
    {
      provide: 'ACTIVE_ACTIVATION',
      useFactory: (
        bikePlugin: BikeEnergyPlugin,
        fastPlugin: FastFeetPlugin,
        genPlugin: EnergyGeneratorPlugin,
      ) => {
        const type = process.env.ACTIVE_ACTIVATION || 'BIKE_ENERGY';
        switch (type) {
          case 'FAST_FEET':
            return fastPlugin;
          case 'ENERGY_GENERATOR':
            return genPlugin;
          case 'BIKE_ENERGY':
          default:
            return bikePlugin;
        }
      },
      inject: [BikeEnergyPlugin, FastFeetPlugin, EnergyGeneratorPlugin],
    },
  ],
  exports: ['ACTIVE_ACTIVATION'],
})
export class ActivationModule {}
