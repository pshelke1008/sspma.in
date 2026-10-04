import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';
import { errorMessage } from '@/i18n/errors';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { FormField } from '@/components/common/forms';
import { Brand } from '@/components/layout/Brand';
import { FullPageLoader } from '@/components/layout/ProtectedRoute';
import { useTranslation } from 'react-i18next';
import { useLabels } from '@/i18n/useLabels';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

const schema = z.object({
  identifier: z.string().trim().min(3, 'validation.identifier'),
  password: z.string().min(1, 'validation.password'),
  rememberMe: z.boolean().default(false),
});

type LoginValues = z.infer<typeof schema>;

const DEMO_ACCOUNTS = [
  { role: 'ADMIN', email: 'admin@ashram.org' },
  { role: 'FINANCE_MANAGER', email: 'finance@ashram.org' },
  { role: 'ACCOUNTANT', email: 'accounts@ashram.org' },
  { role: 'APPROVER', email: 'approver@ashram.org' },
];

export default function LoginPage() {
  const { t } = useTranslation();
  const labels = useLabels();
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '', rememberMe: false },
  });

  if (isLoading) return <FullPageLoader />;
  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      const user = await login(values);
      toast.success(t('auth.welcomeToast', { name: user.name.split(' ')[0] }));
      const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
      navigate(from, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        for (const [field, message] of Object.entries(fieldErrors)) {
          setError(field as keyof LoginValues, { message });
        }
        if (Object.keys(fieldErrors).length === 0) {
          setFormError(error.status === 401 ? t('auth.invalidCredentials') : (errorMessage(t, error) ?? error.message));
        }
      } else {
        setFormError(t('auth.unreachable'));
      }
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Environment visual — a full panel on desktop, a banner on mobile. */}
      <section
        className="relative flex h-44 shrink-0 items-end overflow-hidden bg-brand p-6 lg:h-auto lg:w-[46%] lg:items-center lg:p-12"
        aria-hidden="true"
      >
        <AshramScene />
        <div className="relative z-10 hidden lg:block">
          <Brand size="lg" showTagline={false} className="mb-8" />
          <h2 className="max-w-md whitespace-pre-line text-[30px] font-semibold leading-tight text-white">
            {t('auth.heroTitle')}
          </h2>
          <p className="mt-3 max-w-sm text-[14px] leading-relaxed text-white/80">{t('auth.heroText')}</p>
          <ul className="mt-8 space-y-2.5">
            {t('brand.tagline').split('•').map((word) => word.trim()).map((word) => (
              <li key={word} className="flex items-center gap-2.5 text-[13px] text-white/85">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {word}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 lg:hidden">
          <Brand size="md" />
        </div>
      </section>

      {/* Login card */}
      <section className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8 lg:py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-6 flex items-center justify-between gap-3 lg:mb-8">
            <Brand size="md" tone="dark" className="hidden lg:flex" />
            <LanguageSwitcher signedIn={false} className="ml-auto" />
          </div>

          <h1 className="text-[24px] font-semibold tracking-tight text-ink">{t('auth.welcome')}</h1>
          <p className="mt-1 text-[13px] text-ink-muted">{t('auth.signInPrompt')}</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
            {formError && (
              <div role="alert" className="rounded-control border border-danger/25 bg-danger/5 px-3 py-2.5 text-[12.5px] text-danger">
                {formError}
              </div>
            )}

            <FormField label={t('auth.identifier')} htmlFor="identifier" required error={errors.identifier?.message}>
              <Input
                id="identifier"
                type="text"
                autoComplete="username"
                autoFocus
                placeholder={t('auth.identifierPlaceholder')}
                invalid={Boolean(errors.identifier)}
                {...register('identifier')}
              />
            </FormField>

            <FormField label={t('auth.password')} htmlFor="password" required error={errors.password?.message}>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pr-10"
                  invalid={Boolean(errors.password)}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  aria-pressed={showPassword}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
            </FormField>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-muted">
                <Checkbox
                  id="rememberMe"
                  onCheckedChange={(checked) => setValue('rememberMe', Boolean(checked))}
                />
                {t('auth.rememberMe')}
              </label>
              <button
                type="button"
                onClick={() =>
                  toast.info(t('auth.forgotTitle'), { description: t('auth.forgotText') })
                }
                className="rounded text-[12.5px] font-medium text-brand-primary transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand-primary/50"
              >
                {t('auth.forgotPassword')}
              </button>
            </div>

            <Button type="submit" size="lg" block loading={isSubmitting}>
              {!isSubmitting && <LogIn className="h-4 w-4" aria-hidden="true" />}
              {isSubmitting ? t('auth.signingIn') : t('auth.login')}
            </Button>
          </form>

          <div className="mt-6 rounded-card border border-line bg-white p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{t('auth.demoAccounts')}</p>
            <p className="mt-1 text-[11.5px] text-ink-muted">
              {t('auth.demoPassword')} <code className="rounded bg-canvas px-1 py-0.5 font-medium text-ink">Ashram@2026</code>
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => {
                    setValue('identifier', account.email, { shouldValidate: true });
                    setValue('password', 'Ashram@2026', { shouldValidate: true });
                  }}
                  className="rounded-control border border-line px-2 py-1.5 text-left text-[11.5px] transition-colors hover:border-brand-primary hover:bg-brand-light focus-visible:ring-2 focus-visible:ring-brand-primary/50"
                >
                  <span className="block font-medium text-ink">{labels.roles[account.role]}</span>
                  <span className="block truncate text-[10.5px] text-ink-muted">{account.email}</span>
                </button>
              ))}
            </div>
          </div>

          <p className="mt-8 text-center text-[12px] text-ink-muted">{t('auth.footer')}</p>
        </div>
      </section>
    </div>
  );
}

/** Lightweight inline illustration — no external image request. */
function AshramScene() {
  return (
    <>
      <div className="absolute inset-0 bg-gradient-to-br from-brand via-brand to-[#0A2A66]" />
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.22]"
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMax slice"
        role="presentation"
      >
        <defs>
          <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.1" />
          </linearGradient>
        </defs>
        <circle cx="620" cy="140" r="64" fill="url(#sun)" />
        {/* Distant hills */}
        <path d="M0 470 Q 160 380 320 460 T 640 440 L 800 470 L800 600 L0 600 Z" fill="#ffffff" opacity="0.10" />
        {/* Temple silhouette */}
        <g fill="#ffffff" opacity="0.20">
          <rect x="330" y="400" width="140" height="120" />
          <path d="M400 300 L470 400 L330 400 Z" />
          <rect x="392" y="262" width="16" height="42" rx="4" />
          <circle cx="400" cy="256" r="11" />
          <rect x="360" y="444" width="26" height="76" rx="12" fill="#0657D6" />
          <rect x="414" y="444" width="26" height="76" rx="12" fill="#0657D6" />
        </g>
        {/* Side structures */}
        <g fill="#ffffff" opacity="0.13">
          <rect x="180" y="450" width="120" height="70" />
          <path d="M240 402 L305 450 L175 450 Z" />
          <rect x="500" y="450" width="120" height="70" />
          <path d="M560 402 L625 450 L495 450 Z" />
        </g>
        {/* Trees */}
        <g fill="#ffffff" opacity="0.16">
          <circle cx="110" cy="430" r="34" />
          <rect x="104" y="440" width="12" height="80" />
          <circle cx="700" cy="440" r="28" />
          <rect x="694" y="450" width="12" height="70" />
        </g>
        <rect y="520" width="800" height="80" fill="#ffffff" opacity="0.07" />
      </svg>
    </>
  );
}
