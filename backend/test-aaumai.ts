import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { McaProvider } from './src/search/providers/mca.provider';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const mca = app.get(McaProvider);
  
  try {
    const res = await mca.byCin('U58200PN2025PTC247913');
    console.log('Name:', res.companyName);
    console.log('Address:', res.address);
    console.log('Directors:', res.raw.Directors);
  } catch(e) {}
  await app.close();
}
bootstrap();
