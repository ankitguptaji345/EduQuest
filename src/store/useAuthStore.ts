import { create } from 'zustand';
import type { Profile } from '../types/api';

interface AuthState {
  token: string | null;
  user: Profile | null;
  setAuth: (token: string, user: Profile) => void;
  setUser: (user: Profile) => void;
  logout: () => void;
}

const TOKEN_KEY = 'eduquest_token';
const USER_KEY = 'eduquest_user';

function loadInitialToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function loadInitialUser(): Profile | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  token: loadInitialToken(),
  user: loadInitialUser(),
  setAuth: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  setUser: (user) => {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ user });
  },
  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
}));
