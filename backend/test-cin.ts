import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { McaProvider } from './src/search/providers/mca.provider';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const mca = app.get(McaProvider);
  
  try {
    const res1 = await mca.byCin('U45209TG2021PTC157833');
    console.log('Found CIN U45209TG2021PTC157833:', res1.companyName);
  } catch(e) { console.log('not found 1', e.message); }

  try {
    const res2 = await mca.byCin('U45200TG1996PTC025756');
    console.log('Found CIN U45200TG1996PTC025756:', res2.companyName);
  } catch(e) { console.log('not found 2', e.message); }
  
  await app.close();
}
bootstrap();
