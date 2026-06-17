import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SearchService } from './src/search/search.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const search = app.get(SearchService);
  
  try {
    const res = await search.aggregate('AUMAI HEALTHCARE SOLUTION PRIVATE LIMITED');
    console.log('CIN:', res.cin);
    console.log('Sources:', res.sources);
    console.log('Address:', res.address);
    console.log('AI Overview:', res.aiOverview);
    console.log('Deep Search CIN?:', res.raw.deepSearchCin);
  } catch(e) {}
  await app.close();
}
bootstrap();
