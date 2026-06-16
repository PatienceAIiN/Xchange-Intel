import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { SearchService } from './src/search/search.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const searchService = app.get(SearchService);
  console.log('Running aggregation...');
  const result = await searchService.aggregate('A SEMICONSUMABLES INDIA PRIVATE LIMITED');
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}

bootstrap();
