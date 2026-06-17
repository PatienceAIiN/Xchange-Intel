import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SearchService } from './src/search/search.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const search = app.get(SearchService);
  
  console.log("--- Testing Vamsi Constructions ---");
  try {
    const res1 = await search.aggregate('Vamsi Constructions Private Limited');
    console.log('CIN:', res1.cin);
    console.log('Directors:', res1.directors);
    console.log('Address:', res1.address);
    console.log('Sources:', res1.sources);
  } catch(e) { console.log('not found 1', e.message); }

  console.log("\n--- Testing Aumai Healthcare ---");
  try {
    const res2 = await search.aggregate('AUMAI HEALTHCARE SOLUTION PRIVATE LIMITED');
    console.log('CIN:', res2.cin);
    console.log('Directors:', res2.directors);
    console.log('Address:', res2.address);
    console.log('Sources:', res2.sources);
  } catch(e) { console.log('not found 2', e.message); }

  await app.close();
}
bootstrap();
