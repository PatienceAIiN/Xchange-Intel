import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ZaubaProvider } from './src/search/providers/zauba.provider';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const zauba = app.get(ZaubaProvider);
  
  try {
    const cin = await zauba.resolveCin('AUMAI HEALTHCARE SOLUTION PRIVATE LIMITED');
    console.log('Zauba CIN:', cin);
  } catch(e) {}
  await app.close();
}
bootstrap();
