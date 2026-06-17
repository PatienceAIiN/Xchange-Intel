import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { ZaubaProvider } from './src/search/providers/zauba.provider';
import { McaProvider } from './src/search/providers/mca.provider';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const zauba = app.get(ZaubaProvider);
  const mca = app.get(McaProvider);
  
  try {
    const name = 'AL NAAS INFRACON PRIVATE LIMITED';
    const cin = await zauba.resolveCin(name);
    console.log('Zauba CIN:', cin);
    if (cin) {
      const verified = await mca.byCin(cin).catch(() => null);
      console.log('Verified by MCA:', verified?.companyName);
    }
  } catch(e) {}
  await app.close();
}
bootstrap();
