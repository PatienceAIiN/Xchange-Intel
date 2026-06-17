import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { McaProvider } from './src/search/providers/mca.provider';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const mca = app.get(McaProvider);
  
  try {
    const res1 = await mca.byCin('U58200PN2025PTC247913');
    console.log('Found CIN U58200PN2025PTC247913:', res1.companyName);
  } catch(e) { console.log('not found 1', e.message); }

  await app.close();
}
bootstrap();
