import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './env';
import { apiRouter } from './routes';
import { attachAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: env.isProduction ? undefined : false,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.webOrigin.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    }),
  );

  app.use(
    express.json({
      limit: '2mb',
      // The WhatsApp webhook signature is computed over the exact bytes Meta
      // sent; re-serialising the parsed body would not reproduce them.
      verify: (req, _res, buffer) => {
        if ((req as { url?: string }).url?.startsWith('/api/webhooks/')) {
          (req as unknown as { rawBody: Buffer }).rawBody = Buffer.from(buffer);
        }
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(cookieParser());
  app.use(attachAuth);

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
