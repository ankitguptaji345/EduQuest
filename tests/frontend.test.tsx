// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthPage } from '../src/pages/AuthPage';
import { LandingPage } from '../src/pages/LandingPage';

describe('EduQuest AI Frontend Smoke Tests', () => {
  it('renders LandingPage with tagline and primary CTAs', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByText(/EduQuest AI/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Your AI Teacher · Your Learning World · Your Adventure/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start Learning Now/i })).toBeInTheDocument();
  });

  it('renders AuthPage with Sign In, Sign Up, and Reset tabs', () => {
    render(
      <MemoryRouter>
        <AuthPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /Sign Up/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
  });
});
