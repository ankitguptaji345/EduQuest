import crypto from 'node:crypto';
import { Router } from 'express';
import { AppError } from '../core/errors.ts';
import { hashPassword, signJwt, verifyPassword } from '../core/security.ts';
import { identityRepo } from '../repositories/identityRepo.ts';
import { recommendationService } from '../services/progress/recommendationService.ts';

export const authRouter = Router();

authRouter.post('/register', (req, res, next) => {
  try {
    const { email, password, full_name } = req.body || {};
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      throw new AppError(422, 'INVALID_EMAIL', 'Please provide a valid email address.');
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      throw new AppError(422, 'INVALID_PASSWORD', 'Password must be at least 6 characters.');
    }
    if (identityRepo.findAuthByEmail(email)) {
      throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    const userId = crypto.randomUUID();
    const profile = identityRepo.createUser({
      id: userId,
      email,
      passwordHash: hashPassword(password),
      fullName: typeof full_name === 'string' && full_name.trim() ? full_name.trim() : email.split('@')[0],
    });
    recommendationService.recompute(userId);

    const token = signJwt(profile.id, profile.email);
    res.status(201).json({
      access_token: token,
      token_type: 'bearer',
      user: profile,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new AppError(422, 'MISSING_CREDENTIALS', 'Email and password are required.');
    }
    const authUser = identityRepo.findAuthByEmail(String(email));
    if (!authUser || !verifyPassword(String(password), authUser.password_hash)) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const profile = identityRepo.getProfile(authUser.id)!;
    const token = signJwt(profile.id, profile.email);
    res.json({
      access_token: token,
      token_type: 'bearer',
      user: profile,
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/reset-password', (req, res, next) => {
  try {
    const { email, new_password } = req.body || {};
    if (!email || !new_password || String(new_password).length < 6) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Valid email and new password (6+ characters) are required.',
      );
    }
    const authUser = identityRepo.findAuthByEmail(String(email));
    if (!authUser) {
      // Safe generic response
      res.json({ status: 'ok', message: 'If that account exists, the password has been updated.' });
      return;
    }
    identityRepo.updatePasswordHash(authUser.id, hashPassword(String(new_password)));
    res.json({ status: 'ok', message: 'Password updated successfully. You can now sign in.' });
  } catch (err) {
    next(err);
  }
});
