import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useLabels } from '@/i18n/useLabels';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Brand } from './Brand';
import { SidebarNav } from './Sidebar';

/** Full navigation as a left drawer for tablet and phone widths. */
export function MobileDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const labels = useLabels();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" width="max-w-[262px]" className="bg-sidebar text-ink">
        <SheetTitle className="sr-only">{t('nav.navigation')}</SheetTitle>
        <div className="border-b border-line px-4 py-4 pr-12">
          <Brand />
        </div>
        <SidebarNav onNavigate={() => onOpenChange(false)} />
        <div className="space-y-2.5 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <LanguageSwitcher signedIn />
          <div>
            <p className="truncate text-[11.5px] font-medium text-ink">{user?.organization.name}</p>
            <p className="mt-0.5 text-[10.5px] text-ink-muted">
              {user?.name} · {user ? (labels.roles[user.role.key] ?? user.role.name) : ''}
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
