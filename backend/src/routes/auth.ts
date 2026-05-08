import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { Errors } from '../errors';
import { requireAuth } from '../middleware/auth';
import { authLimiter, refreshLimiter } from '../middleware/rate-limit';
import {
  getUserById,
  login as loginSvc,
  revokeRefresh,
  rotateRefresh,
  signup as signupSvc,
} from '../services/auth';

const SignupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export function buildAuthRouter(): Router {
  const r = Router();

  r.post(
    '/auth/signup',
    authLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = SignupSchema.parse(req.body);
        const { user, tokens } = await signupSvc(body.email, body.password);
        res.status(201).json({ ...tokens, user });
      } catch (err) {
        next(err);
      }
    },
  );

  r.post(
    '/auth/login',
    authLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = LoginSchema.parse(req.body);
        const { user, tokens } = await loginSvc(body.email, body.password);
        res.status(200).json({ ...tokens, user });
      } catch (err) {
        next(err);
      }
    },
  );

  r.post(
    '/auth/refresh',
    refreshLimiter(),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = RefreshSchema.parse(req.body);
        const tokens = await rotateRefresh(body.refreshToken);
        res.status(200).json(tokens);
      } catch (err) {
        next(err);
      }
    },
  );

  r.post('/auth/logout', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = LogoutSchema.parse(req.body);
      await revokeRefresh(body.refreshToken);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  r.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw Errors.unauthorized();
      const user = await getUserById(req.user.id);
      if (!user) throw Errors.unauthorized('User not found');
      res.status(200).json(user);
    } catch (err) {
      next(err);
    }
  });

  return r;
}
