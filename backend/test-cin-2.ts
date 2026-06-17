import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SearchService } from './src/search/search.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const search = app.get(SearchService);
  
  try {
    const res = await search.aggregate('Vamsi Constructions Private Limited');
    console.log('Result CIN:', res.cin);
  } catch(e) { console.log('not found 1', e.message); }
  
  await app.close();
}
bootstrap();
