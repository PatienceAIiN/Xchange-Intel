import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './common/log-buffer';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: new AppLogger() });
  // security headers; allow the SPA + same-origin assets to load
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );

  const origins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);
  new Logger('Bootstrap').log(`Xchange Intel API listening on http://localhost:${port}/api`);
}
bootstrap();
