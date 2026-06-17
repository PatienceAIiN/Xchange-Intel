import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { GoogleProvider } from './src/search/providers/google.provider';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const google = app.get(GoogleProvider);
  
  try {
    const res = await google.search('AUMAI HEALTHCARE SOLUTION PRIVATE LIMITED CIN', true);
    console.log(JSON.stringify(res, null, 2));
  } catch(e) {}
  await app.close();
}
bootstrap();
